import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createTestDb } from './testing.js';
import { claimNextJob, completeJob, enqueueJob, failJob } from './jobs.js';
import type { Db } from './types.js';

let db: Db;
let rid: string;
let n = 0;
const key = () => `k-${++n}`;

beforeAll(async () => {
  db = await createTestDb();
  const [r] = await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('R') RETURNING id`);
  rid = r!.id;
});

// Each test starts with no claimable jobs left over from earlier tests.
beforeEach(async () => {
  await db.query("UPDATE jobs SET status = 'cancelled', locked_by = NULL, lease_expires_at = NULL WHERE status IN ('queued', 'running')");
});

const events = async (jobId: string) =>
  (await db.query<{ event: string }>('SELECT event FROM job_events WHERE job_id = $1 ORDER BY created_at, id', [jobId])).map(
    (e) => e.event,
  );

describe('durable job queue', () => {
  it('enqueue is idempotent: a duplicate key never creates a second job', async () => {
    const k = key();
    const a = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: k });
    const b = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: k });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    expect(await db.query('SELECT 1 FROM jobs WHERE idempotency_key = $1', [k])).toHaveLength(1);
  });

  it('claims once: a second worker cannot claim a job that is already leased', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: key() });
    const first = await claimNextJob(db, 'w1');
    expect(first?.id).toBe(id);
    expect(await claimNextJob(db, 'w2')).toBeNull();
  });

  it('only the lease holder can complete a job', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: key() });
    await claimNextJob(db, 'owner');
    expect(await completeJob(db, id, 'intruder')).toBe(false);
    expect(await completeJob(db, id, 'owner')).toBe(true);
    expect(await events(id)).toEqual(['enqueued', 'claimed', 'succeeded']);
  });

  it('retries failures with backoff, then fails permanently at max_attempts', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 't', idempotencyKey: key(), maxAttempts: 2 });
    await claimNextJob(db, 'w');
    expect(await failJob(db, id, 'w', 'boom', { backoffSeconds: 0 })).toBe('retry');
    await claimNextJob(db, 'w');
    expect(await failJob(db, id, 'w', 'boom again', { backoffSeconds: 0 })).toBe('failed');
    const [j] = await db.query<{ status: string; attempts: number; last_error: string }>(
      'SELECT status, attempts, last_error FROM jobs WHERE id = $1',
      [id],
    );
    expect(j).toMatchObject({ status: 'failed', attempts: 2, last_error: 'boom again' });
    expect(await claimNextJob(db, 'w')).toBeNull();
  });

  it('does not run a job before its scheduled time', async () => {
    const { id } = await enqueueJob(db, {
      restaurantId: rid,
      type: 'system.noop',
      idempotencyKey: key(),
      runAt: new Date(Date.now() + 3_600_000),
    });
    const claimed = await claimNextJob(db, 'w');
    expect(claimed?.id).not.toBe(id);
  });

  it('re-claims a job whose worker crashed (expired lease) until max attempts', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: key(), maxAttempts: 2 });
    expect((await claimNextJob(db, 'crashy', { leaseSeconds: -1 }))?.id).toBe(id); // lease already expired
    const again = await claimNextJob(db, 'healthy');
    expect(again?.id).toBe(id);
    expect(again?.attempts).toBe(2);
    expect(await completeJob(db, id, 'crashy')).toBe(false); // the crashed worker lost its lease
  });

  it('fails a job whose worker vanished on the final attempt instead of retrying forever', async () => {
    const { id } = await enqueueJob(db, { restaurantId: rid, type: 'system.noop', idempotencyKey: key(), maxAttempts: 1 });
    await claimNextJob(db, 'crashy', { leaseSeconds: -1 });
    expect(await claimNextJob(db, 'healthy')).toBeNull();
    const [j] = await db.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [id]);
    expect(j?.status).toBe('failed');
  });
});
