import { randomUUID } from 'node:crypto';
import { createPgDb } from '@the-pocket/db';
import { defaultHandlers, runLoop } from './worker.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. The worker needs a database connection (server-side only).');
  process.exit(1);
}

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 100) {
  console.error('WORKER_POLL_INTERVAL_MS must be a number of at least 100.');
  process.exit(1);
}

const workerId = `worker-${randomUUID().slice(0, 8)}`;
const db = createPgDb(databaseUrl);
const controller = new AbortController();
const log = (msg: string) => console.log(JSON.stringify({ level: 'info', worker: workerId, msg }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`received ${signal}, finishing current job`);
    controller.abort();
  });
}

log('worker started');
await runLoop(db, workerId, defaultHandlers, { pollIntervalMs, signal: controller.signal, log });
await db.close();
log('worker stopped');
