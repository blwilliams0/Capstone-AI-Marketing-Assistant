import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, MIGRATIONS_DIR } from './testing.js';
import { runMigrations } from './migrate.js';
import type { Db } from './types.js';

const UID = '11111111-1111-1111-1111-111111111111';
let db: Db;

async function seed() {
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'a@x.test')`, [UID]);
  await db.query(`INSERT INTO profiles (user_id, email, name) VALUES ($1, 'a@x.test', 'A')`, [UID]);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO restaurants (name) VALUES ('R') RETURNING id`,
  );
  return r!.id;
}

const addMember = (rid: string, role: string, status = 'active') =>
  db.query(`INSERT INTO memberships (restaurant_id, user_id, role, status) VALUES ($1, $2, $3, $4)`, [
    rid,
    UID,
    role,
    status,
  ]);

beforeEach(async () => {
  db = await createTestDb();
});

describe('foundation migration', () => {
  it('applies cleanly and a second run applies nothing', async () => {
    expect(await runMigrations(db, MIGRATIONS_DIR)).toEqual([]);
  });

  it('enables row level security on every application table', async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8); // 7 app tables + schema_migrations
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it('gives the public Data API roles no access to any table', async () => {
    const tables = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    for (const { relname } of tables)
      for (const role of ['anon', 'authenticated'])
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          const [r] = await db.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
            role,
            `public.${relname}`,
            priv,
          ]);
          expect(r!.ok, `${role} ${priv} ${relname}`).toBe(false);
        }
  });

  it('does not let public roles execute the trigger function directly', async () => {
    for (const role of ['anon', 'authenticated', 'public']) {
      const [r] = await db.query<{ ok: boolean }>(
        role === 'public'
          ? `SELECT has_function_privilege('public', 'forbid_change()', 'EXECUTE') AS ok`
          : `SELECT has_function_privilege('${role}', 'forbid_change()', 'EXECUTE') AS ok`,
      );
      expect(r!.ok, role).toBe(false);
    }
  });

  it('gives public roles no access to any sequence', async () => {
    const seqs = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S'`,
    );
    expect(seqs.length).toBeGreaterThan(0);
    for (const { relname } of seqs)
      for (const role of ['anon', 'authenticated'])
        for (const priv of ['USAGE', 'SELECT', 'UPDATE']) {
          const [r] = await db.query<{ ok: boolean }>(`SELECT has_sequence_privilege($1, $2, $3) AS ok`, [role, `public.${relname}`, priv]);
          expect(r!.ok, `${role} ${priv} ${relname}`).toBe(false);
        }
  });

  it('does not let public roles execute ANY function in the public schema', async () => {
    const fns = await db.query<{ sig: string }>(
      `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'`,
    );
    expect(fns.length).toBeGreaterThan(0);
    for (const { sig } of fns)
      for (const role of ['anon', 'authenticated']) {
        const [r] = await db.query<{ ok: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig]);
        expect(r!.ok, `${role} EXECUTE ${sig}`).toBe(false);
      }
  });

  it('audit events cannot be updated or deleted', async () => {
    const rid = await seed();
    await db.query(`INSERT INTO audit_events (restaurant_id, action) VALUES ($1, 'x')`, [rid]);
    await expect(db.query(`UPDATE audit_events SET action = 'y'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
  });

  it('job events are append-only', async () => {
    const rid = await seed();
    const [job] = await db.query<{ id: string }>(
      `INSERT INTO jobs (restaurant_id, type, idempotency_key) VALUES ($1, 't', 'k') RETURNING id`,
      [rid],
    );
    await db.query(`INSERT INTO job_events (job_id, event) VALUES ($1, 'e')`, [job!.id]);
    await expect(db.query(`DELETE FROM job_events`)).rejects.toThrow(/append-only/);
  });

  it('permission events are append-only', async () => {
    const rid = await seed();
    await addMember(rid, 'viewer');
    const [m] = await db.query<{ id: string }>(`SELECT id FROM memberships`);
    await db.query(
      `INSERT INTO permission_events (restaurant_id, membership_id, actor_user_id, event, new_role)
       VALUES ($1, $2, $3, 'invited', 'viewer')`,
      [rid, m!.id, UID],
    );
    await expect(db.query(`UPDATE permission_events SET reason = 'x'`)).rejects.toThrow(/append-only/);
  });

  it('rejects invalid roles and statuses', async () => {
    const rid = await seed();
    await expect(addMember(rid, 'owner')).rejects.toThrow();
    await expect(addMember(rid, 'viewer', 'bogus')).rejects.toThrow();
  });

  it('allows one membership per user per restaurant', async () => {
    const rid = await seed();
    await addMember(rid, 'viewer');
    await expect(addMember(rid, 'admin')).rejects.toThrow();
  });

  it('requires revoker details when a membership is revoked', async () => {
    const rid = await seed();
    await expect(addMember(rid, 'viewer', 'revoked')).rejects.toThrow();
  });

  it('enforces job idempotency keys per restaurant', async () => {
    const rid = await seed();
    const insert = () =>
      db.query(`INSERT INTO jobs (restaurant_id, type, idempotency_key) VALUES ($1, 't', 'same')`, [rid]);
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('refuses to delete a restaurant that has members (restrictive deletes)', async () => {
    const rid = await seed();
    await addMember(rid, 'viewer');
    await expect(db.query(`DELETE FROM restaurants WHERE id = $1`, [rid])).rejects.toThrow();
  });
});
