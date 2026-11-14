import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './types.js';

/** Applies every *.sql file in dir, in name order, once each. Returns the names applied now. */
export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // Supabase grants anon/authenticated broad rights on new public tables by default. Lock this
  // table down every run (idempotent) so migration history can never be read or changed via the Data API.
  await db.exec(`
    ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON schema_migrations FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON schema_migrations FROM authenticated;
      END IF;
    END $$;
  `);
  const done = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
