import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHarness, type Harness } from './testing/harness.js';

let h: Harness;
type U = Awaited<ReturnType<Harness['addUser']>>;
let admin: U, approver: U, approver2: U, contributor: U, contributor2: U, viewer: U, outsider: U;
let ruleItem: string;
let ruleVersion: string;

const as = (u: U) => ({
  get: (p: string) => request(h.app).get(p).set('Authorization', `Bearer ${u.token}`),
  post: (p: string, body: object = {}) => request(h.app).post(p).set('Authorization', `Bearer ${u.token}`).send(body),
});

beforeAll(async () => {
  h = await createHarness();
  admin = await h.addUser('admin');
  approver = await h.addUser('approver');
  approver2 = await h.addUser('approver');
  contributor = await h.addUser('contributor');
  contributor2 = await h.addUser('contributor');
  viewer = await h.addUser('viewer');
  outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Elsewhere') });
  const rule = await as(contributor).post('/api/knowledge', { kind: 'brand_rule', title: 'Patio', body: 'Describe the patio as covered and heated.' });
  ruleItem = rule.body.itemId;
  ruleVersion = rule.body.versionId;
  await as(admin).post(`/api/knowledge/versions/${ruleVersion}/approve`);
});

async function newPost(by: U = contributor, extra: object = {}) {
  const res = await as(by).post('/api/posts', {
    channel: 'instagram',
    audience: 'both',
    angle: 'Patio evenings',
    caption: 'Weeknights on the covered, heated patio.',
    sourceVersionIds: [ruleVersion],
    origin: 'ai_draft',
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.itemId as string;
}

async function submit(itemId: string, by: U = contributor) {
  const res = await as(by).post(`/api/posts/${itemId}/submit`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { approvalId: string; digest: string };
}

const detail = async (itemId: string) => (await as(viewer).get(`/api/posts/${itemId}`)).body;

describe('the approve-and-post journey', () => {
  it('draft → submit → approve → ready to post → posted, with full history', async () => {
    const id = await newPost();
    expect((await detail(id)).status).toBe('draft');
    const { approvalId, digest } = await submit(id);
    expect((await detail(id)).status).toBe('in_review');

    const ok = await as(approver).post(`/api/approvals/${approvalId}/approve`, { note: 'Looks good' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');

    const ready = (await as(contributor).get('/api/posts/ready')).body.ready as { approvalId: string; digest: string; version: { caption: string } }[];
    const card = ready.find((c) => c.approvalId === approvalId)!;
    expect(card.digest).toBe(digest);
    expect(card.version.caption).toBe('Weeknights on the covered, heated patio.');

    const posted = await as(contributor).post(`/api/approvals/${approvalId}/posted`, { digest, postUrl: 'https://instagram.com/p/abc' });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const d = await detail(id);
    expect(d.status).toBe('posted');
    expect(d.post.postUrl).toBe('https://instagram.com/p/abc');
    expect(d.activity.map((e: { event: string }) => e.event)).toEqual(['submitted', 'approved', 'posted']);
    expect((await as(contributor).get('/api/posts/ready')).body.ready.find((c: { approvalId: string }) => c.approvalId === approvalId)).toBeUndefined();

    // Published posts are locked.
    expect((await as(contributor).post(`/api/posts/${id}/versions`, { caption: 'late change' })).status).toBe(409);
    expect((await as(contributor).post(`/api/approvals/${approvalId}/posted`, { digest })).status).toBe(409);

    const actions = (await h.db.query<{ action: string }>(`SELECT action FROM audit_events WHERE details->>'itemId' = $1 ORDER BY created_at`, [id])).map((a) => a.action);
    expect(actions).toEqual(['post.created', 'post.submitted', 'post.approved', 'post.posted']);

    const activity = (await as(viewer).get('/api/activity')).body.activity as { itemId: string }[];
    expect(activity.some((a) => a.itemId === id)).toBe(true);
  });
});

describe('who may do what', () => {
  it('viewers can read posts but cannot create, submit, approve or record posting', async () => {
    const id = await newPost();
    const { approvalId, digest } = await submit(id);
    expect((await as(viewer).get('/api/posts')).status).toBe(200);
    expect((await as(viewer).post('/api/posts', { channel: 'instagram', audience: 'both', caption: 'x' })).status).toBe(403);
    expect((await as(viewer).post(`/api/approvals/${approvalId}/approve`)).status).toBe(403);
    expect((await as(viewer).post(`/api/approvals/${approvalId}/posted`, { digest })).status).toBe(403);
    expect((await as(viewer).get('/api/posts/ready')).status).toBe(403);
  });

  it('contributors cannot approve', async () => {
    const id = await newPost(contributor2);
    const { approvalId } = await submit(id, contributor2);
    expect((await as(contributor).post(`/api/approvals/${approvalId}/approve`)).status).toBe(403);
  });

  it('an approver cannot approve a post they wrote, even with confirmation; another approver can', async () => {
    const id = await newPost(approver);
    const { approvalId } = await submit(id, approver);
    const self = await as(approver).post(`/api/approvals/${approvalId}/approve`, { confirmSelfApproval: true });
    expect(self.status).toBe(403);
    expect(self.body.reason).toBe('self_not_allowed');
    expect((await as(approver2).post(`/api/approvals/${approvalId}/approve`)).status).toBe(200);
  });

  it('an approver cannot approve a post they edited, even if someone else submitted it', async () => {
    const id = await newPost(contributor);
    await as(approver).post(`/api/posts/${id}/versions`, { caption: 'Approver rewrote this.' });
    const { approvalId } = await submit(id, contributor);
    expect((await as(approver).post(`/api/approvals/${approvalId}/approve`)).body.reason).toBe('self_not_allowed');
  });

  it('an administrator approving their own post must confirm, and it is audited as self-approval', async () => {
    const id = await newPost(admin);
    const { approvalId } = await submit(id, admin);
    const first = await as(admin).post(`/api/approvals/${approvalId}/approve`);
    expect(first.status).toBe(409);
    expect(first.body.reason).toBe('needs_self_confirmation');
    const ok = await as(admin).post(`/api/approvals/${approvalId}/approve`, { confirmSelfApproval: true });
    expect(ok.body.status).toBe('self_approved');
    const d = await detail(id);
    expect(d.openApproval.selfApproved).toBe(true);
    expect(d.activity.map((e: { event: string }) => e.event)).toContain('self_approved');
    expect(await h.db.query(`SELECT 1 FROM audit_events WHERE action = 'post.self_approved' AND target_id = $1`, [approvalId])).toHaveLength(1);
  });

  it('only the submitter or an administrator can withdraw a request', async () => {
    const id = await newPost();
    const { approvalId } = await submit(id);
    expect((await as(contributor2).post(`/api/approvals/${approvalId}/withdraw`)).status).toBe(403);
    expect((await as(contributor).post(`/api/approvals/${approvalId}/withdraw`)).status).toBe(200);
    expect((await detail(id)).status).toBe('draft');
  });

  it('another restaurant cannot see or act on posts', async () => {
    const id = await newPost();
    const { approvalId } = await submit(id);
    expect((await as(outsider).get(`/api/posts/${id}`)).status).toBe(404);
    expect((await as(outsider).post(`/api/approvals/${approvalId}/approve`)).status).toBe(404);
    expect((await as(outsider).get('/api/posts')).body.posts).toEqual([]);
  });
});

describe('approval covers exactly one version', () => {
  it('editing an approved post cancels the approval and removes it from Ready to post', async () => {
    const id = await newPost();
    const { approvalId, digest } = await submit(id);
    await as(approver).post(`/api/approvals/${approvalId}/approve`);
    const edit = await as(contributor).post(`/api/posts/${id}/versions`, { caption: 'Weeknights on the patio, now with a new dish.' });
    expect(edit.status).toBe(201);
    expect(edit.body.supersededApproval).toBe(true);
    const d = await detail(id);
    expect(d.status).toBe('draft');
    expect(d.versions).toHaveLength(2);
    expect(d.approvals[0].status).toBe('superseded');
    expect((await as(contributor).post(`/api/approvals/${approvalId}/posted`, { digest })).body.reason).toBe('not_approved');
  });

  it('refuses to record a post when the on-screen fingerprint does not match', async () => {
    const id = await newPost();
    const { approvalId } = await submit(id);
    await as(approver).post(`/api/approvals/${approvalId}/approve`);
    const res = await as(contributor).post(`/api/approvals/${approvalId}/posted`, { digest: 'a'.repeat(64) });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('digest_mismatch');
  });

  it('one open request per post', async () => {
    const id = await newPost();
    await submit(id);
    expect((await as(contributor).post(`/api/posts/${id}/submit`)).body.reason).toBe('already_open');
  });

  it('rejecting or asking for changes needs a note; the post shows the outcome', async () => {
    const id = await newPost();
    const { approvalId } = await submit(id);
    expect((await as(approver).post(`/api/approvals/${approvalId}/request-changes`, {})).status).toBe(400);
    expect((await as(approver).post(`/api/approvals/${approvalId}/request-changes`, { note: 'Name the dish' })).status).toBe(200);
    expect((await detail(id)).status).toBe('changes_requested');
    expect((await as(approver).post(`/api/approvals/${approvalId}/approve`)).body.reason).toBe('not_pending');
  });
});

describe('sources must stay current', () => {
  it('only approved knowledge can be cited', async () => {
    const pending = await as(contributor).post('/api/knowledge', { kind: 'fact', title: 'Unapproved', body: 'Not yet approved.' });
    const res = await as(contributor).post('/api/posts', { channel: 'instagram', audience: 'both', caption: 'x', sourceVersionIds: [pending.body.versionId] });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid_sources');
  });

  it('a brand rule changing after drafting blocks approval and posting until the post is updated', async () => {
    const id = await newPost();
    const { approvalId: early } = await submit(id);
    await as(approver).post(`/api/approvals/${early}/approve`);

    // Management updates the patio rule.
    const v2 = await as(admin).post(`/api/knowledge/${ruleItem}/versions`, { body: 'Describe the patio as covered, heated and dog-friendly.' });
    await as(admin).post(`/api/knowledge/versions/${v2.body.versionId}/approve`, { confirmSelfApproval: true });

    const card = ((await as(contributor).get('/api/posts/ready')).body.ready as { approvalId: string; digest: string; blockers: string[] }[]).find((c) => c.approvalId === early)!;
    expect(card.blockers.join(' ')).toMatch(/Patio/);
    expect((await as(contributor).post(`/api/approvals/${early}/posted`, { digest: card.digest })).body.reason).toBe('stale_sources');

    // Saving an edit refreshes the sources to the current rule; the new version can be approved.
    await as(contributor).post(`/api/posts/${id}/versions`, { caption: 'Weeknights on the covered, heated, dog-friendly patio.' });
    const d = await detail(id);
    expect(d.versions[0].sources.map((s: { versionId: string }) => s.versionId)).toEqual([v2.body.versionId]);
    expect(d.blockers).toEqual([]);
    const { approvalId } = await submit(id);
    expect((await as(approver).post(`/api/approvals/${approvalId}/approve`)).status).toBe(200);

    ruleVersion = v2.body.versionId; // later tests cite the current rule
  });

  it('a post submitted with an outdated source cannot be approved', async () => {
    const id = await newPost();
    const { approvalId } = await submit(id);
    const v3 = await as(admin).post(`/api/knowledge/${ruleItem}/versions`, { body: 'Describe the patio as covered and heated (v3).' });
    await as(admin).post(`/api/knowledge/versions/${v3.body.versionId}/approve`, { confirmSelfApproval: true });
    const res = await as(approver).post(`/api/approvals/${approvalId}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('stale_sources');
    ruleVersion = v3.body.versionId;
  });
});

describe('review hardening', () => {
  it('an approver who wrote an earlier version cannot approve after someone else re-saves it', async () => {
    const id = await newPost(approver);
    await as(contributor).post(`/api/posts/${id}/versions`, { caption: 'Weeknights on the covered, heated patio.' });
    const { approvalId } = await submit(id, contributor);
    expect((await as(approver).post(`/api/approvals/${approvalId}/approve`)).body.reason).toBe('self_not_allowed');
  });

  it('only the creator or a reviewer can archive a post', async () => {
    const id = await newPost(contributor);
    await submit(id, contributor);
    const res = await as(contributor2).post(`/api/posts/${id}/archive`);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('not_allowed');
    expect((await as(approver).post(`/api/posts/${id}/archive`)).status).toBe(200);
  });

  it('an edit that drops a retired fact records it, so the approver is told', async () => {
    const fact = await as(contributor).post('/api/knowledge', { kind: 'fact', title: 'Truffle week', body: 'Truffle menu Nov 1-7.' });
    await as(admin).post(`/api/knowledge/versions/${fact.body.versionId}/approve`);
    const id = await newPost(contributor, { sourceVersionIds: [ruleVersion, fact.body.versionId] });
    await as(admin).post(`/api/knowledge/${fact.body.itemId}/retire`, { reason: 'Event over' });
    expect((await detail(id)).blockers.join(' ')).toMatch(/Truffle week/);

    await as(contributor).post(`/api/posts/${id}/versions`, { caption: 'Weeknights on the patio.' });
    const d = await detail(id);
    expect(d.blockers).toEqual([]);
    expect(d.versions[0].removedSources.map((s: { title: string }) => s.title)).toEqual(['Truffle week']);
    expect(d.versions[0].sources.map((s: { versionId: string }) => s.versionId)).toEqual([ruleVersion]);
  });
});

describe('archiving', () => {
  it('withdraws a waiting request and hides the post from the default list', async () => {
    const id = await newPost();
    await submit(id);
    expect((await as(contributor).post(`/api/posts/${id}/archive`)).status).toBe(200);
    expect((await detail(id)).status).toBe('archived');
    const list = (await as(viewer).get('/api/posts')).body.posts as { id: string }[];
    expect(list.find((p) => p.id === id)).toBeUndefined();
    const all = (await as(viewer).get('/api/posts?archived=true')).body.posts as { id: string }[];
    expect(all.find((p) => p.id === id)).toBeTruthy();
    expect((await as(contributor).post(`/api/posts/${id}/submit`)).status).toBe(409);
  });
});
