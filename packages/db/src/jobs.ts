import type { Db } from './types.js';

export interface Job {
  id: string;
  restaurant_id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
}

export interface EnqueueInput {
  restaurantId: string;
  type: string;
  payload?: Record<string, unknown>;
  /** Same (restaurant, key) never creates a second job: the basis for duplicate prevention. */
  idempotencyKey: string;
  runAt?: Date;
  maxAttempts?: number;
}

async function event(db: Db, jobId: string, name: string, workerId: string | null, detail: string | null = null) {
  await db.query('INSERT INTO job_events (job_id, event, worker_id, detail) VALUES ($1, $2, $3, $4)', [
    jobId,
    name,
    workerId,
    detail,
  ]);
}

/** Queues a job unless one with the same idempotency key already exists. */
export async function enqueueJob(db: Db, input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO jobs (restaurant_id, type, payload, idempotency_key, run_at, max_attempts)
       VALUES ($1, $2, $3::jsonb, $4, COALESCE($5, now()), COALESCE($6, 3))
       ON CONFLICT (restaurant_id, idempotency_key) DO NOTHING RETURNING id`,
      [
        input.restaurantId,
        input.type,
        JSON.stringify(input.payload ?? {}),
        input.idempotencyKey,
        input.runAt?.toISOString() ?? null,
        input.maxAttempts ?? null,
      ],
    );
    if (rows[0]) {
      await event(tx, rows[0].id, 'enqueued', null);
      return { id: rows[0].id, created: true };
    }
    const [existing] = await tx.query<{ id: string }>(
      'SELECT id FROM jobs WHERE restaurant_id = $1 AND idempotency_key = $2',
      [input.restaurantId, input.idempotencyKey],
    );
    return { id: existing!.id, created: false };
  });
}

/**
 * Claims the next due job for this worker with a time-limited lease. Safe with several workers:
 * FOR UPDATE SKIP LOCKED means two workers can never claim the same row. A job whose lease expired
 * (worker crashed) is retried, but never beyond max_attempts.
 */
export async function claimNextJob(
  db: Db,
  workerId: string,
  opts: { leaseSeconds?: number } = {},
): Promise<Job | null> {
  const leaseSeconds = opts.leaseSeconds ?? 300;
  return db.transaction(async (tx) => {
    // Jobs that lost their lease on their final attempt are failed, not silently retried forever.
    const dead = await tx.query<{ id: string }>(
      `UPDATE jobs SET status = 'failed', locked_by = NULL, lease_expires_at = NULL, updated_at = now(),
              last_error = 'Worker stopped responding on the final attempt'
        WHERE status = 'running' AND lease_expires_at < now() AND attempts >= max_attempts RETURNING id`,
    );
    for (const d of dead) await event(tx, d.id, 'failed', null, 'lease expired on final attempt');

    const [job] = await tx.query<Job>(
      `UPDATE jobs SET status = 'running', locked_by = $1, attempts = attempts + 1, updated_at = now(),
              lease_expires_at = now() + make_interval(secs => $2)
        WHERE id = (
          SELECT id FROM jobs
           WHERE run_at <= now()
             AND (status = 'queued' OR (status = 'running' AND lease_expires_at < now() AND attempts < max_attempts))
           ORDER BY run_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, restaurant_id, type, status, payload, idempotency_key, attempts, max_attempts`,
      [workerId, leaseSeconds],
    );
    if (job) await event(tx, job.id, 'claimed', workerId, `attempt ${job.attempts}`);
    return job ?? null;
  });
}

/** Marks success. Only the worker that holds the lease may do so. */
export async function completeJob(db: Db, jobId: string, workerId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      `UPDATE jobs SET status = 'succeeded', locked_by = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'running' AND locked_by = $2 RETURNING id`,
      [jobId, workerId],
    );
    if (rows.length === 0) return false;
    await event(tx, jobId, 'succeeded', workerId);
    return true;
  });
}

/**
 * Records a failure. Retries with a delay until max_attempts, then fails permanently.
 * retry:false fails immediately (e.g. an unknown job type).
 */
export async function failJob(
  db: Db,
  jobId: string,
  workerId: string,
  error: string,
  opts: { retry?: boolean; backoffSeconds?: number } = {},
): Promise<'retry' | 'failed' | 'lost'> {
  const message = error.slice(0, 500);
  return db.transaction(async (tx) => {
    const [job] = await tx.query<{ attempts: number; max_attempts: number }>(
      `SELECT attempts, max_attempts FROM jobs WHERE id = $1 AND status = 'running' AND locked_by = $2 FOR UPDATE`,
      [jobId, workerId],
    );
    if (!job) return 'lost' as const;
    const willRetry = (opts.retry ?? true) && job.attempts < job.max_attempts;
    if (willRetry) {
      const backoff = opts.backoffSeconds ?? Math.min(2 ** job.attempts * 30, 3600);
      await tx.query(
        `UPDATE jobs SET status = 'queued', locked_by = NULL, lease_expires_at = NULL, last_error = $2,
                run_at = now() + make_interval(secs => $3), updated_at = now() WHERE id = $1`,
        [jobId, message, backoff],
      );
      await event(tx, jobId, 'retry_scheduled', workerId, message);
      return 'retry' as const;
    }
    await tx.query(
      `UPDATE jobs SET status = 'failed', locked_by = NULL, lease_expires_at = NULL, last_error = $2, updated_at = now() WHERE id = $1`,
      [jobId, message],
    );
    await event(tx, jobId, 'failed', workerId, message);
    return 'failed' as const;
  });
}
