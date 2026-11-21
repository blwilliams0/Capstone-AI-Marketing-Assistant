import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createTestDb } from './testing.js';
import type { Db } from './types.js';

let db: Db;
let rid: string;
let otherRid: string;
const users: Record<'admin' | 'approver' | 'contributor' | 'viewer' | 'approver2', string> = {
  admin: '',
  approver: '',
  contributor: '',
  viewer: '',
  approver2: '',
};

async function addUser(role: string, restaurantId: string) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@x.test`]);
  await db.query('INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3)', [id, `${id}@x.test`, role]);
  await db.query(`INSERT INTO memberships (restaurant_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [restaurantId, id, role]);
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  rid = (await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('R') RETURNING id`))[0]!.id;
  otherRid = (await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('Other') RETURNING id`))[0]!.id;
  users.admin = await addUser('admin', rid);
  users.approver = await addUser('approver', rid);
  users.approver2 = await addUser('approver', rid);
  users.contributor = await addUser('contributor', rid);
  users.viewer = await addUser('viewer', rid);
});

async function newPost(by = users.contributor, caption = 'Weeknights on the patio.') {
  const [item] = await db.query<{ id: string }>(
    `INSERT INTO content_items (restaurant_id, title, created_by) VALUES ($1, 'Patio', $2) RETURNING id`,
    [rid, by],
  );
  const v = await addVersion(item!.id, 1, by, caption);
  return { itemId: item!.id, versionId: v.id, digest: v.digest };
}

async function addVersion(itemId: string, version: number, by: string, caption: string, knowledge: string[] = []) {
  const [v] = await db.query<{ id: string; digest: string; snapshot: Record<string, unknown> }>(
    `INSERT INTO content_versions (item_id, restaurant_id, version, channel, audience, caption, origin, created_by, knowledge_version_ids, digest)
     VALUES ($1, $2, $3, 'instagram', 'both', $4, 'human', $5, $6::uuid[], 'forged') RETURNING id, digest, snapshot`,
    [itemId, rid, version, caption, by, knowledge],
  );
  return v!;
}

async function submit(itemId: string, versionId: string, by = users.contributor) {
  const [a] = await db.query<{ id: string; digest: string }>(
    `INSERT INTO approval_requests (restaurant_id, item_id, content_version_id, requested_by, digest)
     VALUES ($1, $2, $3, $4, 'forged') RETURNING id, digest`,
    [rid, itemId, versionId, by],
  );
  return a!;
}

const decide = (id: string, by: string, status = 'approved', self = false, note: string | null = null) =>
  db.query(`UPDATE approval_requests SET status = $2, decided_by = $3, decided_at = now(), self_approved = $4, decision_note = $5 WHERE id = $1`, [
    id,
    status,
    by,
    self,
    note,
  ]);

const status = async (id: string) => (await db.query<{ status: string }>('SELECT status FROM approval_requests WHERE id = $1', [id]))[0]!.status;

describe('post versions', () => {
  it('computes the snapshot and digest in the database (a supplied digest is ignored)', async () => {
    const p = await newPost();
    const [row] = await db.query<{ snapshot: unknown; digest: string }>('SELECT snapshot::text AS snapshot, digest FROM content_versions WHERE id = $1', [p.versionId]);
    expect(row!.digest).not.toBe('forged');
    expect(row!.digest).toBe(createHash('sha256').update(String(row!.snapshot), 'utf8').digest('hex'));
    expect(String(row!.snapshot)).toContain('Weeknights on the patio.');
  });

  it('gives different text a different digest', async () => {
    const a = await newPost(users.contributor, 'Text A');
    const b = await newPost(users.contributor, 'Text B');
    expect(a.digest).not.toBe(b.digest);
  });

  it('versions cannot be edited or deleted', async () => {
    const p = await newPost();
    await expect(db.query(`UPDATE content_versions SET caption = 'changed' WHERE id = $1`, [p.versionId])).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM content_versions WHERE id = $1`, [p.versionId])).rejects.toThrow(/append-only/);
  });

  it('refuses knowledge from another restaurant', async () => {
    const otherUser = await addUser('admin', otherRid);
    const [ki] = await db.query<{ id: string }>(
      `INSERT INTO knowledge_items (restaurant_id, kind, title, created_by) VALUES ($1, 'fact', 'Other fact', $2) RETURNING id`,
      [otherRid, otherUser],
    );
    const [kv] = await db.query<{ id: string }>(
      `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, proposed_by) VALUES ($1, $2, 1, 'x', 'human', $3) RETURNING id`,
      [ki!.id, otherRid, otherUser],
    );
    const p = await newPost();
    await expect(addVersion(p.itemId, 2, users.contributor, 'v2', [kv!.id])).rejects.toThrow(/own restaurant/);
  });
});

describe('approval requests', () => {
  it('copy the digest of the version they approve, ignoring any supplied digest', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    expect(a.digest).toBe(p.digest);
  });

  it('must start pending and cannot be inserted approved', async () => {
    const p = await newPost();
    await expect(
      db.query(
        `INSERT INTO approval_requests (restaurant_id, item_id, content_version_id, requested_by, status, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, 'approved', $4, now())`,
        [rid, p.itemId, p.versionId, users.admin],
      ),
    ).rejects.toThrow(/start as pending/);
  });

  it('allow one open request per post', async () => {
    const p = await newPost();
    await submit(p.itemId, p.versionId);
    await expect(submit(p.itemId, p.versionId)).rejects.toThrow();
  });

  it('only the latest version can be submitted', async () => {
    const p = await newPost();
    await addVersion(p.itemId, 2, users.contributor, 'second');
    await expect(submit(p.itemId, p.versionId)).rejects.toThrow(/latest version/);
  });

  it('contributors and viewers cannot decide; an approver can approve someone else\'s post', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await expect(decide(a.id, users.contributor)).rejects.toThrow(/approver or administrator/);
    await expect(decide(a.id, users.viewer)).rejects.toThrow(/approver or administrator/);
    await decide(a.id, users.approver);
    expect(await status(a.id)).toBe('approved');
  });

  it('an approver cannot approve a post they submitted or wrote', async () => {
    const p = await newPost(users.approver);
    const a = await submit(p.itemId, p.versionId, users.approver);
    await expect(decide(a.id, users.approver, 'approved', true)).rejects.toThrow(/only an administrator/);
    await expect(decide(a.id, users.approver, 'approved', false)).rejects.toThrow(/flagged exactly/);

    // Written by the approver, submitted by someone else: still self-approval.
    const q = await newPost(users.approver);
    const b = await submit(q.itemId, q.versionId, users.contributor);
    await expect(decide(b.id, users.approver, 'approved', true)).rejects.toThrow(/only an administrator/);
    await decide(b.id, users.approver2);
    expect(await status(b.id)).toBe('approved');
  });

  it('an administrator may approve their own post only when it is flagged as self-approval', async () => {
    const p = await newPost(users.admin);
    const a = await submit(p.itemId, p.versionId, users.admin);
    await expect(decide(a.id, users.admin, 'approved', false)).rejects.toThrow(/flagged exactly/);
    await decide(a.id, users.admin, 'approved', true);
    const events = await db.query<{ event: string }>(`SELECT event FROM approval_events WHERE approval_id = $1 ORDER BY created_at`, [a.id]);
    expect(events.map((e) => e.event)).toEqual(['submitted', 'self_approved']);
  });

  it('flagging someone else\'s post as self-approved is refused', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await expect(decide(a.id, users.admin, 'approved', true)).rejects.toThrow(/flagged exactly/);
  });

  it('rejecting or asking for changes needs a note', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await expect(decide(a.id, users.approver, 'rejected', false, null)).rejects.toThrow();
    await decide(a.id, users.approver, 'changes_requested', false, 'Name the dish');
    expect(await status(a.id)).toBe('changes_requested');
    await expect(decide(a.id, users.approver)).rejects.toThrow(/invalid approval change/); // decided already
  });

  it('a removed approver can no longer decide', async () => {
    const gone = await addUser('approver', rid);
    await db.query(`UPDATE memberships SET status = 'revoked', revoked_at = now(), revoked_by = $1 WHERE user_id = $2`, [users.admin, gone]);
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await expect(decide(a.id, gone)).rejects.toThrow(/approver or administrator/);
  });

  it('the approved digest, version and requester cannot be changed', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await expect(db.query(`UPDATE approval_requests SET digest = 'x' WHERE id = $1`, [a.id])).rejects.toThrow(/cannot be changed/);
    await expect(db.query(`DELETE FROM approval_requests WHERE id = $1`, [a.id])).rejects.toThrow(/cannot be deleted/);
  });
});

describe('editing after approval', () => {
  it('a new version supersedes an approved request and records who changed it', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await decide(a.id, users.approver);
    await addVersion(p.itemId, 2, users.contributor, 'Edited after approval');
    expect(await status(a.id)).toBe('superseded');
    const events = await db.query<{ event: string; actor_user_id: string }>(
      `SELECT event, actor_user_id FROM approval_events WHERE approval_id = $1 ORDER BY created_at, event`,
      [a.id],
    );
    expect(events.map((e) => e.event)).toEqual(['submitted', 'approved', 'superseded']);
    expect(events.at(-1)!.actor_user_id).toBe(users.contributor);
  });

  it('a new version also supersedes a pending request', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await addVersion(p.itemId, 2, users.contributor, 'Edited while waiting');
    expect(await status(a.id)).toBe('superseded');
  });
});

describe('post records', () => {
  const record = (approvalId: string, itemId: string, versionId: string, by = users.contributor) =>
    db.query<{ digest: string }>(
      `INSERT INTO post_records (restaurant_id, item_id, approval_id, content_version_id, posted_by, digest)
       VALUES ($1, $2, $3, $4, $5, 'forged') RETURNING digest`,
      [rid, itemId, approvalId, versionId, by],
    );

  it('can only be made from an approved request and copy its digest', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await expect(record(a.id, p.itemId, p.versionId)).rejects.toThrow(/only an approved post/);
    await decide(a.id, users.approver);
    const [r] = await record(a.id, p.itemId, p.versionId);
    expect(r!.digest).toBe(p.digest);
    const events = await db.query<{ event: string }>(`SELECT event FROM approval_events WHERE approval_id = $1 ORDER BY created_at`, [a.id]);
    expect(events.map((e) => e.event)).toContain('posted');
  });

  it('viewers cannot record a post; a post is recorded once and then locked', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await decide(a.id, users.approver);
    await expect(record(a.id, p.itemId, p.versionId, users.viewer)).rejects.toThrow(/active staff/);
    await record(a.id, p.itemId, p.versionId);
    await expect(record(a.id, p.itemId, p.versionId)).rejects.toThrow();
    await expect(addVersion(p.itemId, 2, users.contributor, 'too late')).rejects.toThrow(/already been published/);
    await expect(db.query(`UPDATE post_records SET note = 'x' WHERE approval_id = $1`, [a.id])).rejects.toThrow(/append-only/);
  });

  it('approval history cannot be edited or deleted', async () => {
    await expect(db.query(`UPDATE approval_events SET note = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM approval_events`)).rejects.toThrow(/append-only/);
  });
});

describe('review hardening', () => {
  it('anyone who wrote any version counts as self, so a trivial edit by someone else cannot launder it', async () => {
    const p = await newPost(users.approver, 'Written by the approver');
    await addVersion(p.itemId, 2, users.contributor, 'Written by the approver.');
    const [latest] = await db.query<{ id: string }>(`SELECT id FROM content_versions WHERE item_id = $1 AND version = 2`, [p.itemId]);
    const a = await submit(p.itemId, latest!.id, users.contributor);
    await expect(decide(a.id, users.approver, 'approved', false)).rejects.toThrow(/flagged exactly/);
    await expect(decide(a.id, users.approver, 'approved', true)).rejects.toThrow(/only an administrator/);
    await decide(a.id, users.approver2);
  });

  it('the database refuses approval and posting when a cited rule has changed', async () => {
    const [ki] = await db.query<{ id: string }>(`INSERT INTO knowledge_items (restaurant_id, kind, title, created_by) VALUES ($1, 'brand_rule', 'Tone', $2) RETURNING id`, [rid, users.admin]);
    const newKv = async (n: number) =>
      (await db.query<{ id: string }>(`INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, proposed_by) VALUES ($1, $2, $3, $4, 'human', $5) RETURNING id`, [ki!.id, rid, n, `Tone v${n}`, users.admin]))[0]!.id;
    const approveKv = (id: string) => db.query(`UPDATE knowledge_versions SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [id, users.admin]);
    const k1 = await newKv(1);
    await approveKv(k1);

    const [item] = await db.query<{ id: string }>(`INSERT INTO content_items (restaurant_id, title, created_by) VALUES ($1, 'Cites tone', $2) RETURNING id`, [rid, users.contributor]);
    const v = await addVersion(item!.id, 1, users.contributor, 'Warm and understated.', [k1]);
    const a = await submit(item!.id, v.id);
    const b = await (async () => {
      const [i2] = await db.query<{ id: string }>(`INSERT INTO content_items (restaurant_id, title, created_by) VALUES ($1, 'Also cites tone', $2) RETURNING id`, [rid, users.contributor]);
      const v2 = await addVersion(i2!.id, 1, users.contributor, 'Also warm.', [k1]);
      const req = await submit(i2!.id, v2.id);
      await decide(req.id, users.approver);
      return { req, itemId: i2!.id, versionId: v2.id };
    })();

    // Management replaces the rule.
    const k2 = await newKv(2);
    await db.query(`UPDATE knowledge_versions SET status = 'superseded', superseded_at = now() WHERE id = $1`, [k1]);
    await approveKv(k2);

    await expect(decide(a.id, users.approver)).rejects.toThrow(/knowledge that has changed/);
    await expect(
      db.query(`INSERT INTO post_records (restaurant_id, item_id, approval_id, content_version_id, posted_by) VALUES ($1, $2, $3, $4, $5)`, [
        rid,
        b.itemId,
        b.req.id,
        b.versionId,
        users.contributor,
      ]),
    ).rejects.toThrow(/knowledge that has changed/);
  });

  it('viewers and former staff cannot write or submit posts', async () => {
    await expect(newPost(users.viewer)).rejects.toThrow(/only active staff/);
    const p = await newPost();
    await expect(submit(p.itemId, p.versionId, users.viewer)).rejects.toThrow(/only active staff/);
  });

  it('a published post cannot be archived', async () => {
    const p = await newPost();
    const a = await submit(p.itemId, p.versionId);
    await decide(a.id, users.approver);
    await db.query(`INSERT INTO post_records (restaurant_id, item_id, approval_id, content_version_id, posted_by) VALUES ($1, $2, $3, $4, $5)`, [
      rid,
      p.itemId,
      a.id,
      p.versionId,
      users.contributor,
    ]);
    await expect(db.query(`UPDATE content_items SET archived_at = now(), archived_by = $2 WHERE id = $1`, [p.itemId, users.admin])).rejects.toThrow(/cannot be archived/);
  });
});

describe('archiving', () => {
  it('is one-way and blocks new versions and submissions', async () => {
    const p = await newPost();
    await db.query(`UPDATE content_items SET archived_at = now(), archived_by = $2 WHERE id = $1`, [p.itemId, users.contributor]);
    await expect(addVersion(p.itemId, 2, users.contributor, 'x')).rejects.toThrow(/archived/);
    await expect(submit(p.itemId, p.versionId)).rejects.toThrow(/archived/);
    await expect(db.query(`UPDATE content_items SET archived_at = NULL, archived_by = NULL WHERE id = $1`, [p.itemId])).rejects.toThrow(/cannot be undone/);
    await expect(db.query(`DELETE FROM content_items WHERE id = $1`, [p.itemId])).rejects.toThrow(/archive them instead/);
  });
});
