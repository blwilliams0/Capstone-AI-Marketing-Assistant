import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createTestDb } from './testing.js';
import type { Db } from './types.js';

let db: Db;
let rid: string;
let uid: string;

beforeAll(async () => {
  db = await createTestDb();
  uid = randomUUID();
  await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, 'k@x.test']);
  await db.query('INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3)', [uid, 'k@x.test', 'K']);
  rid = (await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('R') RETURNING id`))[0]!.id;
});

async function newItem(kind = 'brand_rule', inCore = false) {
  const [item] = await db.query<{ id: string }>(
    `INSERT INTO knowledge_items (restaurant_id, kind, title, in_brand_core, created_by) VALUES ($1, $2, 'T', $3, $4) RETURNING id`,
    [rid, kind, inCore, uid],
  );
  return item!.id;
}

async function propose(itemId: string, version: number, body = 'Describe the patio as covered and heated.') {
  const [v] = await db.query<{ id: string; digest: string; status: string }>(
    `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, proposed_by)
     VALUES ($1, $2, $3, $4, 'human', $5) RETURNING id, digest, status`,
    [itemId, rid, version, body, uid],
  );
  return v!;
}

const approve = (vid: string) =>
  db.query(`UPDATE knowledge_versions SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [vid, uid]);

describe('knowledge library schema', () => {
  it('computes the digest in the database from the body', async () => {
    const body = 'Never call The Pocket "cheap".';
    const v = await propose(await newItem(), 1, body);
    expect(v.digest).toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
    expect(v.status).toBe('proposed');
  });

  it('refuses to insert a version that is already approved', async () => {
    const item = await newItem();
    await expect(
      db.query(
        `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, status, proposed_by, decided_by, decided_at)
         VALUES ($1, $2, 1, 'x', 'ai_proposal', 'approved', $3, $3, now())`,
        [item, rid, uid],
      ),
    ).rejects.toThrow(/must be created as proposals/);
  });

  it('allows proposed -> approved and blocks editing the approved text', async () => {
    const v = await propose(await newItem(), 1);
    await approve(v.id);
    await expect(db.query(`UPDATE knowledge_versions SET body = 'changed' WHERE id = $1`, [v.id])).rejects.toThrow(/immutable/);
    await expect(db.query(`UPDATE knowledge_versions SET expires_at = now() WHERE id = $1`, [v.id])).rejects.toThrow(/immutable/);
  });

  it('blocks changing who approved, and blocks going back to proposed', async () => {
    const v = await propose(await newItem(), 1);
    await approve(v.id);
    await expect(db.query(`UPDATE knowledge_versions SET decided_at = now() - interval '1 day' WHERE id = $1`, [v.id])).rejects.toThrow();
    await expect(
      db.query(`UPDATE knowledge_versions SET status = 'proposed', decided_by = NULL, decided_at = NULL WHERE id = $1`, [v.id]),
    ).rejects.toThrow(/invalid knowledge version change/);
  });

  it('allows approved -> superseded only, and a rejected version stays rejected', async () => {
    const item = await newItem();
    const v1 = await propose(item, 1);
    await approve(v1.id);
    await db.query(`UPDATE knowledge_versions SET status = 'superseded', superseded_at = now() WHERE id = $1`, [v1.id]);
    const v2 = await propose(item, 2);
    await db.query(`UPDATE knowledge_versions SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [v2.id, uid]);
    await expect(approve(v2.id)).rejects.toThrow(/invalid knowledge version change/);
  });

  it('allows only one approved version per item', async () => {
    const item = await newItem();
    const v1 = await propose(item, 1);
    const v2 = await propose(item, 2, 'second');
    await approve(v1.id);
    await expect(approve(v2.id)).rejects.toThrow();
  });

  it('cannot delete versions or items', async () => {
    const item = await newItem();
    const v = await propose(item, 1);
    await expect(db.query('DELETE FROM knowledge_versions WHERE id = $1', [v.id])).rejects.toThrow(/cannot be deleted/);
    await expect(db.query('DELETE FROM knowledge_items WHERE id = $1', [item])).rejects.toThrow(/cannot be deleted/);
  });

  it('retiring an item is one-way, and its kind cannot change', async () => {
    const item = await newItem();
    await db.query(`UPDATE knowledge_items SET retired_at = now(), retired_by = $2, retire_reason = 'old' WHERE id = $1`, [item, uid]);
    await expect(db.query(`UPDATE knowledge_items SET retired_at = NULL, retired_by = NULL WHERE id = $1`, [item])).rejects.toThrow(/cannot be undone/);
    await expect(db.query(`UPDATE knowledge_items SET kind = 'fact' WHERE id = $1`, [item])).rejects.toThrow(/identity/);
  });

  it('keeps long documents out of the brand core', async () => {
    await expect(newItem('strategy', true)).rejects.toThrow();
    await expect(newItem('reference', true)).rejects.toThrow();
    expect(await newItem('fact', true)).toBeTruthy();
  });

  it('a version must belong to an item of the same restaurant', async () => {
    const other = (await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('Other') RETURNING id`))[0]!.id;
    const item = await newItem();
    await expect(
      db.query(
        `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, proposed_by) VALUES ($1, $2, 1, 'x', 'human', $3)`,
        [item, other, uid],
      ),
    ).rejects.toThrow();
  });

  it('full-text search finds sections and sections are append-only', async () => {
    const v = await propose(await newItem('strategy'), 1, 'whole doc');
    await db.query(
      `INSERT INTO knowledge_sections (version_id, restaurant_id, position, heading, body) VALUES
       ($1, $2, 0, 'Patio', 'The covered and heated patio is open all year.'),
       ($1, $2, 1, 'Wine', 'Monthly wine dinners with pairings.')`,
      [v.id, rid],
    );
    const hits = await db.query<{ heading: string }>(
      `SELECT heading FROM knowledge_sections WHERE version_id = $1 AND search @@ websearch_to_tsquery('english', 'heated patios')`,
      [v.id],
    );
    expect(hits.map((h) => h.heading)).toEqual(['Patio']);
    await expect(db.query(`UPDATE knowledge_sections SET body = 'x' WHERE version_id = $1`, [v.id])).rejects.toThrow(/append-only/);
  });
});
