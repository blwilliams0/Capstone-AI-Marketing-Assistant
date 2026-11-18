import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './types.js';
import { runMigrations } from './migrate.js';

type Runner = Pick<PGlite, 'query' | 'exec'>;

function wrap(runner: Runner, root?: PGlite): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await runner.query<T>(sql, params);
      return res.rows;
    },
    async exec(sql) {
      await runner.exec(sql);
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R> {
      if (!root) throw new Error('Nested transactions are not supported');
      return root.transaction((tx) => fn(wrap(tx as unknown as Runner)));
    },
    async close() {
      if (root) await root.close();
    },
  };
}

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations',
);

/** Minimal stand-in for Supabase's auth.users so the real migration can run in tests. */
const SUPABASE_STUB = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT);
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  END $$;
  -- Real Supabase grants these by default on every new public table. Reproduce it so tests catch
  -- any table the migrations forget to lock down.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
`;

/** In-process Postgres (no Docker) with the real migrations applied. Tests only. */
export async function createTestDb(): Promise<Db> {
  const pglite = new PGlite();
  const db = wrap(pglite, pglite);
  await db.exec(SUPABASE_STUB);
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}
