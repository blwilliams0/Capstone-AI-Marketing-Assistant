import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHarness, type Harness } from './testing/harness.js';

let h: Harness;
type U = Awaited<ReturnType<Harness['addUser']>>;
let admin: U, admin2: U, approver: U, contributor: U, viewer: U;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.addUser('admin');
  admin2 = await h.addUser('admin');
  approver = await h.addUser('approver');
  contributor = await h.addUser('contributor');
  viewer = await h.addUser('viewer');
});

const as = (u: U) => ({
  get: (p: string) => request(h.app).get(p).set('Authorization', `Bearer ${u.token}`),
  post: (p: string, body: object = {}) => request(h.app).post(p).set('Authorization', `Bearer ${u.token}`).send(body),
});

async function proposeRule(by: U, title: string, body: string, kind = 'brand_rule') {
  const res = await as(by).post('/api/knowledge', { kind, title, body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { itemId: string; versionId: string };
}

const core = async () => (await as(viewer).get('/api/knowledge/brand-core')).body as { entries: { title: string; versionId: string }[]; words: number };

describe('knowledge: proposals and approval authority', () => {
  it('a contributor proposal is pending, hidden from viewers, and not in the brand core', async () => {
    const p = await proposeRule(contributor, 'Patio wording', 'Describe the patio as covered and heated.');
    const forContrib = (await as(contributor).get('/api/knowledge')).body.items as { id: string; pending: unknown[]; current: unknown }[];
    const mine = forContrib.find((i) => i.id === p.itemId)!;
    expect(mine.current).toBeNull();
    expect(mine.pending).toHaveLength(1);
    const forViewer = (await as(viewer).get('/api/knowledge')).body.items as { id: string }[];
    expect(forViewer.find((i) => i.id === p.itemId)).toBeUndefined();
    expect((await core()).entries.find((e) => e.title === 'Patio wording')).toBeUndefined();
  });

  it('viewers cannot propose; contributors and approvers cannot approve brand knowledge', async () => {
    expect((await as(viewer).post('/api/knowledge', { kind: 'fact', title: 'x', body: 'y' })).status).toBe(403);
    const p = await proposeRule(contributor, 'Tone', 'Warm, understated, never boastful.');
    expect((await as(contributor).post(`/api/knowledge/versions/${p.versionId}/approve`)).status).toBe(403);
    expect((await as(approver).post(`/api/knowledge/versions/${p.versionId}/approve`)).status).toBe(403);
  });

  it('an administrator approves exactly that version; it enters the brand core and is audited', async () => {
    const p = await proposeRule(contributor, 'Never say', 'Never describe The Pocket as cheap or a bargain.');
    const res = await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`, { note: 'Agreed with Elliot' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    const c = await core();
    expect(c.entries.find((e) => e.versionId === p.versionId)).toBeTruthy();
    const audit = await h.db.query('SELECT 1 FROM audit_events WHERE action = $1 AND target_id = $2', ['knowledge.approved', p.versionId]);
    expect(audit).toHaveLength(1);
    expect((await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`)).status).toBe(409); // already decided
  });

  it('an administrator approving their own proposal must confirm, and it is audited as self-approved', async () => {
    const p = await proposeRule(admin, 'Chef stories', 'Chef stories are welcome when the chef agrees.');
    const first = await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`);
    expect(first.status).toBe(409);
    expect(first.body.reason).toBe('needs_self_confirmation');
    const ok = await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`, { confirmSelfApproval: true });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('self_approved');
    expect(
      await h.db.query('SELECT 1 FROM audit_events WHERE action = $1 AND target_id = $2', ['knowledge.self_approved', p.versionId]),
    ).toHaveLength(1);
  });

  it('a different administrator approving needs no self-confirmation', async () => {
    const p = await proposeRule(admin, 'Wine', 'Wine is central to the experience.');
    expect((await as(admin2).post(`/api/knowledge/versions/${p.versionId}/approve`)).status).toBe(200);
  });

  it('rejecting requires a reason', async () => {
    const p = await proposeRule(contributor, 'Fun', 'The Pocket is a party spot.');
    expect((await as(admin).post(`/api/knowledge/versions/${p.versionId}/reject`)).status).toBe(400);
    expect((await as(admin).post(`/api/knowledge/versions/${p.versionId}/reject`, { note: 'Does not fit the brand' })).status).toBe(200);
  });
});

describe('knowledge: versions, expiry, retirement and the brand core', () => {
  it('a new proposal does not replace the approved text until it is approved, then supersedes it', async () => {
    const p = await proposeRule(contributor, 'Hours', 'Open 5pm to 9pm Tuesday to Sunday.', 'fact');
    await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`);
    const v2 = await as(contributor).post(`/api/knowledge/${p.itemId}/versions`, { body: 'Open 5pm to 10pm Tuesday to Sunday.' });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect((await core()).entries.find((e) => e.versionId === p.versionId)).toBeTruthy();

    await as(admin).post(`/api/knowledge/versions/${v2.body.versionId}/approve`);
    const c = await core();
    expect(c.entries.find((e) => e.versionId === p.versionId)).toBeUndefined();
    expect(c.entries.find((e) => e.versionId === v2.body.versionId)).toBeTruthy();

    const hist = (await as(contributor).get(`/api/knowledge/${p.itemId}`)).body.versions as { version: number; status: string }[];
    expect(hist.map((v) => [v.version, v.status])).toEqual([
      [2, 'approved'],
      [1, 'superseded'],
    ]);
  });

  it('expired facts drop out of the brand core and cannot be approved', async () => {
    const p = await proposeRule(contributor, 'Truffle dish', 'Truffle risotto is on the menu this week.', 'fact');
    await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`);
    expect((await core()).entries.find((e) => e.versionId === p.versionId)).toBeTruthy();
    // Simulate time passing by adding an already-expired version directly, then approving it.
    const [late] = await h.db.query<{ id: string }>(
      `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, proposed_by, expires_at)
       VALUES ($1, $2, 2, 'Expired dish', 'human', $3, now() - interval '1 hour') RETURNING id`,
      [p.itemId, h.restaurantId, contributor.userId],
    );
    const res = await as(admin).post(`/api/knowledge/versions/${late!.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('expired');
  });

  it('rejects expiry dates in the past at proposal time', async () => {
    const res = await as(contributor).post('/api/knowledge', {
      kind: 'fact',
      title: 'Old event',
      body: 'Wine dinner',
      expiresAt: '2000-01-01T00:00:00Z',
    });
    expect(res.status).toBe(400);
  });

  it('retiring removes an item from the brand core and blocks new versions', async () => {
    const p = await proposeRule(contributor, 'Old rule', 'Old guidance.');
    await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`);
    expect((await as(contributor).post(`/api/knowledge/${p.itemId}/retire`, { reason: 'x' })).status).toBe(403);
    expect((await as(admin).post(`/api/knowledge/${p.itemId}/retire`, { reason: 'Outdated' })).status).toBe(200);
    expect((await core()).entries.find((e) => e.versionId === p.versionId)).toBeUndefined();
    expect((await as(contributor).post(`/api/knowledge/${p.itemId}/versions`, { body: 'new' })).status).toBe(409);
  });

  it('refuses to let the brand core grow past its size limit', async () => {
    const huge = Array.from({ length: 4100 }, (_, i) => `word${i}`).join(' ');
    const p = await proposeRule(contributor, 'Huge rule', huge);
    const res = await as(admin).post(`/api/knowledge/versions/${p.versionId}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('core_too_large');
  });

  it('only brand rules and facts can be put in the brand core', async () => {
    const p = await proposeRule(contributor, 'Strategy', '# Plan\nTwo audiences.', 'strategy');
    expect((await as(admin).post(`/api/knowledge/${p.itemId}/brand-core`, { inBrandCore: true })).status).toBe(409);
  });
});

describe('knowledge: search', () => {
  it('finds sections of approved documents only', async () => {
    const draft = await proposeRule(contributor, 'Draft strategy', '# Patio\nThe heated patio for winter evenings.', 'strategy');
    const approved = await proposeRule(
      contributor,
      'Approved strategy',
      '# Locals\nSeasonal menu changes give locals reasons to return.\n\n# Tourists\nThe covered heated patio and Carmel atmosphere.',
      'strategy',
    );
    await as(admin).post(`/api/knowledge/versions/${approved.versionId}/approve`);

    const hits = (await as(viewer).get('/api/knowledge/search?q=heated%20patio%20for%20tourists')).body.hits as { versionId: string; heading: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((x) => x.versionId === approved.versionId || x.versionId !== draft.versionId)).toBe(true);
    expect(hits.find((x) => x.versionId === draft.versionId)).toBeUndefined();
    expect(hits[0]!.heading).toBe('Tourists');
  });

  it('validates the query', async () => {
    expect((await as(viewer).get('/api/knowledge/search?q=a')).status).toBe(400);
  });
});

describe('knowledge: restaurant boundary', () => {
  it("another restaurant's administrator can neither see nor approve this restaurant's knowledge", async () => {
    const p = await proposeRule(contributor, 'Private rule', 'Internal guidance.');
    const other = await h.addRestaurant('Other');
    const outsider = await h.addUser('admin', { restaurantId: other });
    expect((await as(outsider).post(`/api/knowledge/versions/${p.versionId}/approve`)).status).toBe(404);
    expect((await as(outsider).get(`/api/knowledge/${p.itemId}`)).status).toBe(404);
    const theirs = (await as(outsider).get('/api/knowledge')).body.items as unknown[];
    expect(theirs).toHaveLength(0);
  });
});
