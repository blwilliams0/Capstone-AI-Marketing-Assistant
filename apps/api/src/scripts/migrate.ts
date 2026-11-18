import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgDb, runMigrations } from '@the-pocket/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env.local (server-side only).');
  process.exit(1);
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/migrations');
const db = createPgDb(url);
try {
  const applied = await runMigrations(db, dir);
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Database is already up to date.');
} finally {
  await db.close();
}
