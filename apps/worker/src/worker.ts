import { claimNextJob, completeJob, failJob, type Db, type Job } from '@the-pocket/db';

export type JobHandler = (job: Job) => Promise<void>;

/**
 * Stage 1 registers only a harmless no-op. There is deliberately NO publishing handler: real
 * handlers arrive in later stages and must re-check approvals and permissions before acting.
 */
export const defaultHandlers: Record<string, JobHandler> = {
  'system.noop': async () => {},
};

export type RunResult = 'idle' | 'succeeded' | 'retry' | 'failed' | 'lost';

/** Claims and executes at most one job. Handler errors never crash the worker. */
export async function runOnce(
  db: Db,
  workerId: string,
  handlers: Record<string, JobHandler> = defaultHandlers,
  opts: { leaseSeconds?: number; backoffSeconds?: number } = {},
): Promise<RunResult> {
  const job = await claimNextJob(db, workerId, { leaseSeconds: opts.leaseSeconds });
  if (!job) return 'idle';

  const handler = Object.hasOwn(handlers, job.type) ? handlers[job.type] : undefined;
  if (!handler) {
    // Unknown job types fail safely and immediately; they are never guessed at or retried.
    const r = await failJob(db, job.id, workerId, `No handler registered for job type "${job.type}"`, { retry: false });
    return r === 'lost' ? 'lost' : 'failed';
  }

  try {
    await handler(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failJob(db, job.id, workerId, message, { backoffSeconds: opts.backoffSeconds });
  }
  return (await completeJob(db, job.id, workerId)) ? 'succeeded' : 'lost';
}

export interface LoopOptions {
  pollIntervalMs: number;
  signal: AbortSignal;
  log?: (msg: string) => void;
}

/** Polls until aborted, finishing the job in progress before stopping (graceful shutdown). */
export async function runLoop(
  db: Db,
  workerId: string,
  handlers: Record<string, JobHandler>,
  opts: LoopOptions,
): Promise<void> {
  const log = opts.log ?? (() => {});
  while (!opts.signal.aborted) {
    let result: RunResult = 'idle';
    try {
      result = await runOnce(db, workerId, handlers);
    } catch (err) {
      log(`worker error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result === 'idle') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, opts.pollIntervalMs);
        opts.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}
