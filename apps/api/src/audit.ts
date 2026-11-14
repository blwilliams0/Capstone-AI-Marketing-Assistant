import type { Db } from '@the-pocket/db';

export interface AuditEntry {
  restaurantId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|api[-_]?key|cookie|credential/i;

/** Recursively replaces values of sensitive-looking keys so secrets never reach audit history. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** Writes one append-only business audit event. Pass a transaction handle to make it atomic with the change. */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (restaurant_id, actor_user_id, action, target_type, target_id, details, request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      entry.restaurantId,
      entry.actorUserId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(redact(entry.details ?? {})),
      entry.requestId ?? null,
    ],
  );
}
