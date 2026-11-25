import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPgDb, runMigrations } from '@the-pocket/db';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (url.href !== 'postgresql://pocket_preview@127.0.0.1:55437/postgres') {
  throw new Error('The preview bootstrap only accepts its dedicated loopback PostgreSQL cluster.');
}

const db = createPgDb(url.href);
try {
  await db.exec('CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);');
  const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
  await runMigrations(db, dir);
  await db.exec(await readFile(new URL('./preview-seed.sql', import.meta.url), 'utf8'));
} finally {
  await db.close();
}
