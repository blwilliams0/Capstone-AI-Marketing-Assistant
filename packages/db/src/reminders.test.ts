import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb } from './testing.js';
import { runReminderScan } from './reminders.js';
import type { Db } from './types.js';

let db: Db;
let rid: string;
const u = { admin: '', approver: '', contributor: '', viewer: '' };
const NOW = new Date('2026-12-01T18:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

async function addUser(role: string) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@x.test`]);
  await db.query('INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3)', [id, `${id}@x.test`, role]);
  await db.query(`INSERT INTO memberships (restaurant_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [rid, id, role]);
  return id;
}

async function post(title: string, scheduledFor: string | null) {
  const [item] = await db.query<{ id: string }>(`INSERT INTO content_items (restaurant_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`, [rid, title, u.contributor]);
  const [v] = await db.query<{ id: string }>(
    `INSERT INTO content_versions (item_id, restaurant_id, version, channel, audience, caption, origin, created_by, scheduled_for)
     VALUES ($1, $2, 1, 'instagram', 'both', 'Text', 'human', $3, $4) RETURNING id`,
    [item!.id, rid, u.contributor, scheduledFor],
  );
  return { itemId: item!.id, versionId: v!.id };
}

async function submit(p: { itemId: string; versionId: string }, requestedAt?: string) {
  const [a] = await db.query<{ id: string }>(
    `INSERT INTO approval_requests (restaurant_id, item_id, content_version_id, requested_by, requested_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now())) RETURNING id`,
    [rid, p.itemId, p.versionId, u.contributor, requestedAt ?? null],
  );
  return a!.id;
}
const approve = (id: string) => db.query(`UPDATE approval_requests SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [id, u.approver]);

const kinds = async (userId: string) =>
  (await db.query<{ kind: string; title: string }>(`SELECT kind, title FROM notifications WHERE recipient_user_id = $1 ORDER BY kind, title`, [userId])).map((n) => `${n.kind}: ${n.title}`);

beforeAll(async () => {
  db = await createTestDb();
  rid = (await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('R') RETURNING id`))[0]!.id;
  u.admin = await addUser('admin');
  u.approver = await addUser('approver');
  u.contributor = await addUser('contributor');
  u.viewer = await addUser('viewer');

  // Approved and due in 3 hours; approved and 5 hours overdue; scheduled tomorrow, never submitted;
  // waiting for approval for 2 days; scheduled far ahead (no reminder).
  const due = await post('Due soon', hours(3));
  await approve(await submit(due));
  const late = await post('Late one', hours(-5));
  await approve(await submit(late));
  await post('Forgot to submit', hours(30));
  await submit(await post('Stuck in review', hours(200)), hours(-48));
  await approve(await submit(await post('Far ahead', hours(24 * 10))));

  // A fact expiring in 3 days and one that expired yesterday.
  for (const [title, exp] of [
    ['Truffle week', hours(72)],
    ['Summer hours', hours(-24)],
  ] as const) {
    const [ki] = await db.query<{ id: string }>(`INSERT INTO knowledge_items (restaurant_id, kind, title, created_by) VALUES ($1, 'fact', $2, $3) RETURNING id`, [rid, title, u.admin]);
    const [kv] = await db.query<{ id: string }>(
      `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, proposed_by, expires_at) VALUES ($1, $2, 1, 'x', 'human', $3, $4) RETURNING id`,
      [ki!.id, rid, u.admin, exp],
    );
    await db.query(`UPDATE knowledge_versions SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [kv!.id, u.admin]);
  }
});

describe('reminder scan', () => {
  it('creates the right reminders for the right people', async () => {
    const created = await runReminderScan(db, rid, NOW);
    expect(created).toBeGreaterThan(0);

    expect(await kinds(u.contributor)).toEqual([
      'post_due: Time to post: Due soon',
      'post_not_submitted: Needs approval soon: Forgot to submit',
      'post_overdue: Not posted yet: Late one',
    ]);
    expect(await kinds(u.approver)).toEqual([
      'approval_waiting: Waiting for approval: Stuck in review',
      'post_due: Time to post: Due soon',
      'post_overdue: Not posted yet: Late one',
    ]);
    expect(await kinds(u.admin)).toEqual([
      'approval_waiting: Waiting for approval: Stuck in review',
      'fact_expired: Fact expired: Summer hours',
      'fact_expiring: Fact expiring soon: Truffle week',
      'post_due: Time to post: Due soon',
      'post_overdue: Not posted yet: Late one',
    ]);
    expect(await kinds(u.viewer)).toEqual([]);
  });

  it('uses the restaurant time zone in the wording', async () => {
    const [n] = await db.query<{ body: string }>(`SELECT body FROM notifications WHERE kind = 'post_due' LIMIT 1`);
    expect(n!.body).toMatch(/Tue Dec 1, 1:00 PM/); // 21:00 UTC is 1 PM in Carmel
  });

  it('running again creates nothing new', async () => {
    expect(await runReminderScan(db, rid, NOW)).toBe(0);
  });

  it('only "read" can change, once; reminders cannot be deleted', async () => {
    const [n] = await db.query<{ id: string }>(`SELECT id FROM notifications LIMIT 1`);
    await db.query(`UPDATE notifications SET read_at = now() WHERE id = $1`, [n!.id]);
    await expect(db.query(`UPDATE notifications SET read_at = NULL WHERE id = $1`, [n!.id])).rejects.toThrow(/only marking/);
    await expect(db.query(`UPDATE notifications SET title = 'x' WHERE id = $1`, [n!.id])).rejects.toThrow(/only marking/);
    await expect(db.query(`DELETE FROM notifications WHERE id = $1`, [n!.id])).rejects.toThrow(/cannot be deleted/);
  });

  it('links are in-app paths only', async () => {
    await expect(
      db.query(`INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key) VALUES ($1, $2, 'post_due', 't', 'b', 'https://evil.example', 'k')`, [rid, u.admin]),
    ).rejects.toThrow();
  });
});
