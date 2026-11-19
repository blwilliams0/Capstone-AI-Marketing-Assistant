import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHarness, type Harness } from './testing/harness.js';

let h: Harness;
type U = Awaited<ReturnType<Harness['addUser']>>;
let admin: U, approver: U, contributor: U, viewer: U;
const inHours = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();
const day = (iso: string) => iso.slice(0, 10);

const as = (u: U) => ({
  get: (p: string) => request(h.app).get(p).set('Authorization', `Bearer ${u.token}`),
  post: (p: string, body: object = {}) => request(h.app).post(p).set('Authorization', `Bearer ${u.token}`).send(body),
});

async function scheduledPost(title: string, at: string | undefined, approve = false) {
  const c = await as(contributor).post('/api/posts', { title, channel: 'instagram', audience: 'both', caption: `${title} text`, scheduledFor: at });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  if (approve) {
    const s = await as(contributor).post(`/api/posts/${c.body.itemId}/submit`);
    await as(approver).post(`/api/approvals/${s.body.approvalId}/approve`);
  }
  return c.body.itemId as string;
}

beforeAll(async () => {
  h = await createHarness();
  admin = await h.addUser('admin');
  approver = await h.addUser('approver');
  contributor = await h.addUser('contributor');
  viewer = await h.addUser('viewer');
});

describe('calendar', () => {
  it('shows scheduled posts in range and lists posts without a date', async () => {
    const soon = await scheduledPost('Soon', inHours(3), true);
    const later = await scheduledPost('Next month', inHours(24 * 40));
    const undated = await scheduledPost('No date yet', undefined);
    const res = await as(viewer).get(`/api/calendar?from=${day(inHours(-24))}&to=${day(inHours(24 * 7))}`);
    expect(res.status).toBe(200);
    expect(res.body.posts.map((p: { itemId: string }) => p.itemId)).toEqual([soon]);
    expect(res.body.posts[0].status).toBe('approved');
    expect(res.body.posts.map((p: { itemId: string }) => p.itemId)).not.toContain(later);
    expect(res.body.unscheduled.map((p: { itemId: string }) => p.itemId)).toContain(undated);
  });

  it('shows fact expiry dates', async () => {
    const f = await as(admin).post('/api/knowledge', { kind: 'fact', title: 'Holiday hours', body: 'Open Dec 24 until 8pm.', expiresAt: inHours(48) });
    await as(admin).post(`/api/knowledge/versions/${f.body.versionId}/approve`, { confirmSelfApproval: true });
    const res = await as(viewer).get(`/api/calendar?from=${day(inHours(0))}&to=${day(inHours(24 * 5))}`);
    expect(res.body.facts.map((x: { title: string }) => x.title)).toContain('Holiday hours');
  });

  it('rejects bad or very long ranges', async () => {
    expect((await as(viewer).get('/api/calendar?from=2026-12-10&to=2026-12-01')).status).toBe(400);
    expect((await as(viewer).get('/api/calendar?from=2026-01-01&to=2026-12-31')).status).toBe(400);
    expect((await as(viewer).get('/api/calendar?from=yesterday&to=today')).status).toBe(400);
  });
});

describe('notifications', () => {
  it('reminds staff when an approved post is due, only once, and each person sees only their own', async () => {
    const res = await as(contributor).get('/api/notifications');
    expect(res.status).toBe(200);
    const due = (res.body.notifications as { kind: string; title: string; link: string; id: string }[]).filter((n) => n.kind === 'post_due');
    expect(due.map((n) => n.title)).toContain('Time to post: Soon');
    expect(due[0]!.link).toBe('/ready');
    expect(res.body.unread).toBeGreaterThan(0);

    // Viewers can't post, so they get no "time to post" reminders.
    const v = await as(viewer).get('/api/notifications');
    expect(v.body.notifications).toEqual([]);

    // Another person cannot mark my reminder as read.
    await as(approver).post(`/api/notifications/${due[0]!.id}/read`);
    const again = await as(contributor).get('/api/notifications');
    expect(again.body.notifications.find((n: { id: string }) => n.id === due[0]!.id).read).toBe(false);

    await as(contributor).post(`/api/notifications/${due[0]!.id}/read`);
    const after = await as(contributor).get('/api/notifications');
    expect(after.body.notifications.find((n: { id: string }) => n.id === due[0]!.id).read).toBe(true);

    await as(contributor).post('/api/notifications/read-all');
    expect((await as(contributor).get('/api/notifications')).body.unread).toBe(0);
  });
});
