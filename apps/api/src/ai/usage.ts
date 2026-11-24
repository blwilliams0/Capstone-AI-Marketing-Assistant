import type { Db } from '@the-pocket/db';
import type { AiUsage } from './provider.js';

/**
 * Published Claude Opus 5.5 prices, US dollars per million tokens (checked 2026-11-13).
 * Estimates only: the Anthropic invoice is authoritative. Cache writes use the 5-minute rate.
 */
export const PRICES_PER_MILLION = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } as const;

export function estimateCostUsd(u: AiUsage, provider: 'anthropic' | 'mock'): number {
  if (provider === 'mock') return 0;
  const p = PRICES_PER_MILLION;
  const cost =
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type AiTask = 'answer' | 'draft' | 'interview' | 'extract' | 'photo_review';
export type AiOutcome = 'ok' | 'refused' | 'error' | 'blocked_budget';

export async function recordUsage(
  db: Db,
  e: { restaurantId: string; userId: string; task: AiTask; provider: 'anthropic' | 'mock'; model: string; usage: AiUsage; outcome: AiOutcome },
): Promise<number> {
  const cost = estimateCostUsd(e.usage, e.provider);
  await db.query(
    `INSERT INTO ai_usage_events (restaurant_id, user_id, task, provider, model, input_tokens, output_tokens,
                                  cache_read_tokens, cache_write_tokens, cost_usd, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      e.restaurantId,
      e.userId,
      e.task,
      e.provider,
      e.model,
      e.usage.inputTokens,
      e.usage.outputTokens,
      e.usage.cacheReadTokens,
      e.usage.cacheWriteTokens,
      cost,
      e.outcome,
    ],
  );
  return cost;
}

/** Estimated spend this calendar month (UTC) for one restaurant. */
export async function monthToDateCostUsd(db: Db, restaurantId: string): Promise<number> {
  const [r] = await db.query<{ total: string | number | null }>(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage_events
      WHERE restaurant_id = $1 AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [restaurantId],
  );
  return Number(r?.total ?? 0);
}

export interface UsageSummary {
  monthToDateUsd: number;
  budgetUsd: number;
  requestsThisMonth: number;
  provider: 'anthropic' | 'mock' | 'disabled';
}

export async function usageSummary(
  db: Db,
  restaurantId: string,
  budgetUsd: number,
  provider: UsageSummary['provider'],
): Promise<UsageSummary> {
  const [r] = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ai_usage_events
      WHERE restaurant_id = $1 AND outcome = 'ok' AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [restaurantId],
  );
  return { monthToDateUsd: await monthToDateCostUsd(db, restaurantId), budgetUsd, requestsThisMonth: r?.n ?? 0, provider };
}
