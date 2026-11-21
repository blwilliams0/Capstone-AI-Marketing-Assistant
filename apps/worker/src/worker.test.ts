import { describe, it, expect, beforeAll } from 'vitest';
import { enqueueJob, type Db } from '@the-pocket/db';
import { createTestDb } from '@the-pocket/db/testing';
import { buildHandlers, defaultHandlers, runOnce, scheduleReminderScans, type JobHandler } from './worker.js';

let db: Db;
let rid: string;
let n = 0;
const key = () => `w-${++n}`;

beforeAll(async () => {
  db = await createTestDb();
  const [r] = await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('R') RETURNING id`);
  rid = r!.id;
});

const status = async (id: string) =>
  (await db.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [id]))[0]?.status;

describe('worker', () => {
  it('is idle when nothing is queued', async () => {
    expect(await runOnce(db, 'w')).toBe('idle');
  });

  it('runs the system.noop job to completion', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: key() });
    expect(await runOnce(db, 'w')).toBe('succeeded');
    expect(await status(id)).toBe('succeeded');
  });

  it('fails an unknown job type immediately and never retries it', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'publish_social_post', idempotencyKey: key() });
    expect(await runOnce(db, 'w')).toBe('failed');
    expect(await status(id)).toBe('failed');
    expect(await runOnce(db, 'w')).toBe('idle');
  });

  it('has no publishing handler registered in Stage 1', () => {
    expect(Object.keys(defaultHandlers)).toEqual(['system.noop']);
  });

  it('does not treat inherited object keys as handlers', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'toString', idempotencyKey: key() });
    expect(await runOnce(db, 'w')).toBe('failed');
    expect(await status(id)).toBe('failed');
  });

  it('survives a throwing handler: the job is retried, the worker keeps running', async () => {
    const calls: string[] = [];
    const flaky: JobHandler = async (job) => {
      calls.push(job.id);
      if (calls.length === 1) throw new Error('temporary failure');
    };
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'flaky', idempotencyKey: key() });
    expect(await runOnce(db, 'w', { flaky }, { backoffSeconds: 0 })).toBe('retry');
    expect(await status(id)).toBe('queued');
    expect(await runOnce(db, 'w', { flaky })).toBe('succeeded');
    expect(calls).toHaveLength(2);
  });

  it('two workers never both execute the same job', async () => {
    let executions = 0;
    const counting: JobHandler = async () => {
      executions += 1;
      await new Promise((r) => setTimeout(r, 50));
    };
    await enqueueJob(db, { restaurantId: rid, type: 'count', idempotencyKey: key() });
    const results = await Promise.all([
      runOnce(db, 'a', { count: counting }),
      runOnce(db, 'b', { count: counting }),
    ]);
    expect(executions).toBe(1);
    expect(results.filter((r) => r === 'succeeded')).toHaveLength(1);
  });
});

describe('reminder scans', () => {
  it('queues one scan per restaurant per 15-minute window, however often it is called', async () => {
    await db.query(`UPDATE jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')`);
    const t = new Date('2026-12-01T18:01:00Z');
    expect(await scheduleReminderScans(db, t)).toBe(1);
    expect(await scheduleReminderScans(db, new Date('2026-12-01T18:14:00Z'))).toBe(0);
    expect(await scheduleReminderScans(db, new Date('2026-12-01T18:16:00Z'))).toBe(1);
  });

  it('runs the scan job through the normal handler table, and still has no publishing handler', async () => {
    const handlers = buildHandlers(db);
    expect(Object.keys(handlers).sort()).toEqual(['reminders.scan', 'system.noop']);
    expect(await runOnce(db, 'w-scan', handlers)).toBe('succeeded');
  });
});
