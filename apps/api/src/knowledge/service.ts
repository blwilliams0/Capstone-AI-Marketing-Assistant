import type { Db } from '@the-pocket/db';
import {
  BRAND_CORE_MAX_WORDS,
  type KnowledgeItemView,
  type KnowledgeKind,
  type KnowledgeVersionView,
} from '@the-pocket/shared';
import { recordAudit } from '../audit.js';
import type { AuthContext } from '../types.js';
import { countWords, splitIntoSections } from './sections.js';

export type Origin = 'human' | 'interview' | 'ai_proposal';

interface VersionRow {
  id: string;
  item_id: string;
  version: number;
  body: string;
  digest: string;
  origin: Origin;
  status: KnowledgeVersionView['status'];
  source_note: string | null;
  proposed_by: string;
  proposed_by_name: string;
  proposed_at: Date | string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  decision_note: string | null;
  expires_at: Date | string | null;
}

const VERSION_SELECT = `
  SELECT v.id, v.item_id, v.version, v.body, v.digest, v.origin, v.status, v.source_note,
         v.proposed_by, pp.name AS proposed_by_name, v.proposed_at,
         v.decided_by, pd.name AS decided_by_name, v.decided_at, v.decision_note, v.expires_at
    FROM knowledge_versions v
    JOIN profiles pp ON pp.user_id = v.proposed_by
    LEFT JOIN profiles pd ON pd.user_id = v.decided_by`;

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

function toView(r: VersionRow): KnowledgeVersionView {
  const expiresAt = iso(r.expires_at);
  return {
    id: r.id,
    version: r.version,
    body: r.body,
    digest: r.digest,
    origin: r.origin,
    status: r.status,
    sourceNote: r.source_note,
    proposedBy: { id: r.proposed_by, name: r.proposed_by_name },
    proposedAt: iso(r.proposed_at)!,
    decidedBy: r.decided_by ? { id: r.decided_by, name: r.decided_by_name ?? '' } : null,
    decidedAt: iso(r.decided_at),
    decisionNote: r.decision_note,
    expiresAt,
    expired: expiresAt !== null && new Date(expiresAt).getTime() <= Date.now(),
  };
}

interface ItemRow {
  id: string;
  kind: KnowledgeKind;
  title: string;
  in_brand_core: boolean;
  retired_at: Date | string | null;
}

/**
 * Lists the library. People who can propose see pending proposals and retired items; viewers see
 * only items with a current approved version.
 */
export async function listItems(db: Db, restaurantId: string, opts: { includePending: boolean }): Promise<KnowledgeItemView[]> {
  const items = await db.query<ItemRow>(
    `SELECT id, kind, title, in_brand_core, retired_at FROM knowledge_items WHERE restaurant_id = $1 ORDER BY kind, title`,
    [restaurantId],
  );
  const statuses = opts.includePending ? ['approved', 'proposed'] : ['approved'];
  const versions = await db.query<VersionRow>(
    `${VERSION_SELECT} WHERE v.restaurant_id = $1 AND v.status = ANY($2::text[]) ORDER BY v.version`,
    [restaurantId, statuses],
  );
  const byItem = new Map<string, VersionRow[]>();
  for (const v of versions) byItem.set(v.item_id, [...(byItem.get(v.item_id) ?? []), v]);

  const out: KnowledgeItemView[] = [];
  for (const i of items) {
    const vs = byItem.get(i.id) ?? [];
    const current = vs.find((v) => v.status === 'approved');
    const retired = i.retired_at !== null;
    if (!opts.includePending && (retired || !current)) continue;
    out.push({
      id: i.id,
      kind: i.kind,
      title: i.title,
      inBrandCore: i.in_brand_core,
      retired,
      current: current ? toView(current) : null,
      pending: vs.filter((v) => v.status === 'proposed').map(toView),
    });
  }
  return out;
}

export async function getHistory(
  db: Db,
  restaurantId: string,
  itemId: string,
  opts: { includeAll: boolean },
): Promise<{ item: ItemRow; versions: KnowledgeVersionView[] } | null> {
  const [item] = await db.query<ItemRow>(
    `SELECT id, kind, title, in_brand_core, retired_at FROM knowledge_items WHERE id = $1 AND restaurant_id = $2`,
    [itemId, restaurantId],
  );
  if (!item) return null;
  const statuses = opts.includeAll ? ['proposed', 'approved', 'rejected', 'superseded'] : ['approved', 'superseded'];
  const versions = await db.query<VersionRow>(
    `${VERSION_SELECT} WHERE v.item_id = $1 AND v.status = ANY($2::text[]) ORDER BY v.version DESC`,
    [itemId, statuses],
  );
  return { item, versions: versions.map(toView) };
}

async function insertVersion(
  tx: Db,
  args: { itemId: string; restaurantId: string; version: number; body: string; origin: Origin; sourceNote?: string; expiresAt?: string; proposedBy: string; title: string },
): Promise<{ id: string; digest: string }> {
  const [v] = await tx.query<{ id: string; digest: string }>(
    `INSERT INTO knowledge_versions (item_id, restaurant_id, version, body, origin, source_note, expires_at, proposed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, digest`,
    [args.itemId, args.restaurantId, args.version, args.body, args.origin, args.sourceNote ?? null, args.expiresAt ?? null, args.proposedBy],
  );
  const sections = splitIntoSections(args.title, args.body);
  for (const [position, s] of sections.entries()) {
    await tx.query(
      `INSERT INTO knowledge_sections (version_id, restaurant_id, position, heading, body) VALUES ($1, $2, $3, $4, $5)`,
      [v!.id, args.restaurantId, position, s.heading, s.body],
    );
  }
  return v!;
}

export interface CreateInput {
  kind: KnowledgeKind;
  title: string;
  body: string;
  sourceNote?: string;
  expiresAt?: string;
  origin?: Origin;
}

/** Creates an item with its first version, always as a proposal awaiting approval. */
export async function createItem(db: Db, actor: AuthContext, input: CreateInput, requestId?: string) {
  return db.transaction((tx) => createItemTx(tx, actor, input, requestId));
}

/** Same as createItem, inside a transaction the caller already holds. */
export async function createItemTx(tx: Db, actor: AuthContext, input: CreateInput, requestId?: string) {
  {
    const [item] = await tx.query<{ id: string }>(
      `INSERT INTO knowledge_items (restaurant_id, kind, title, in_brand_core, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [actor.restaurantId, input.kind, input.title, input.kind === 'brand_rule' || input.kind === 'fact', actor.userId],
    );
    const origin = input.origin ?? 'human';
    const v = await insertVersion(tx, {
      itemId: item!.id,
      restaurantId: actor.restaurantId,
      version: 1,
      body: input.body,
      origin,
      sourceNote: input.sourceNote,
      expiresAt: input.expiresAt,
      proposedBy: actor.userId,
      title: input.title,
    });
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'knowledge.proposed',
      targetType: 'knowledge_version',
      targetId: v.id,
      details: { itemId: item!.id, kind: input.kind, title: input.title, version: 1, origin, digest: v.digest },
      requestId,
    });
    return { itemId: item!.id, versionId: v.id };
  }
}

export async function proposeVersion(
  db: Db,
  actor: AuthContext,
  itemId: string,
  input: { body: string; sourceNote?: string; expiresAt?: string; origin?: Origin },
  requestId?: string,
): Promise<{ versionId: string; version: number } | 'not_found' | 'retired' | 'visual_required'> {
  return db.transaction((tx) => proposeVersionTx(tx, actor, itemId, input, requestId));
}

export async function proposeVersionTx(
  tx: Db,
  actor: AuthContext,
  itemId: string,
  input: { body: string; sourceNote?: string; expiresAt?: string; origin?: Origin },
  requestId?: string,
  visual = false,
): Promise<{ versionId: string; version: number } | 'not_found' | 'retired' | 'visual_required'> {
  const [item] = await tx.query<{ id: string; title: string; kind: string; retired_at: unknown }>(
    `SELECT id, title, kind, retired_at FROM knowledge_items WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
    [itemId, actor.restaurantId],
  );
  if (!item) return 'not_found' as const;
  if (item.retired_at) return 'retired' as const;
  if (!visual && (await tx.query(`SELECT 1 FROM visual_standards s JOIN knowledge_versions v
    ON v.id = s.version_id WHERE v.item_id = $1 LIMIT 1`, [itemId])).length) return 'visual_required';
  const [{ next }] = (await tx.query<{ next: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM knowledge_versions WHERE item_id = $1`,
    [itemId],
  )) as [{ next: number }];
  const origin = input.origin ?? 'human';
  const v = await insertVersion(tx, {
    itemId,
    restaurantId: actor.restaurantId,
    version: next,
    body: input.body,
    origin,
    sourceNote: input.sourceNote,
    expiresAt: input.expiresAt,
    proposedBy: actor.userId,
    title: item.title,
  });
  await recordAudit(tx, {
    restaurantId: actor.restaurantId,
    actorUserId: actor.userId,
    action: 'knowledge.proposed',
    targetType: 'knowledge_version',
    targetId: v.id,
    details: { itemId, kind: item.kind, version: next, origin, digest: v.digest },
    requestId,
  });
  return { versionId: v.id, version: next };
}

/** Words currently in the brand core, optionally ignoring one item (the one about to change). */
async function coreWords(tx: Db, restaurantId: string, exceptItemId?: string): Promise<number> {
  const rows = await tx.query<{ body: string }>(
    `SELECT v.body FROM knowledge_items i
       JOIN knowledge_versions v ON v.item_id = i.id AND v.status = 'approved'
      WHERE i.restaurant_id = $1 AND i.in_brand_core AND i.retired_at IS NULL
        AND (v.expires_at IS NULL OR v.expires_at > now()) AND ($2::uuid IS NULL OR i.id <> $2::uuid)`,
    [restaurantId, exceptItemId ?? null],
  );
  return rows.reduce((n, r) => n + countWords(r.body), 0);
}

export type DecideOutcome =
  | 'approved'
  | 'self_approved'
  | 'rejected'
  | 'not_found'
  | 'not_pending'
  | 'retired'
  | 'expired'
  | 'needs_self_confirmation'
  | 'core_too_large';

/**
 * Approves or rejects one proposed version. Caller must already hold brand.approve (administrators).
 * An administrator approving their own proposal must confirm explicitly; it is audited separately.
 * Approving supersedes the item's previous approved version in the same transaction.
 */
export async function decideVersion(
  db: Db,
  actor: AuthContext,
  versionId: string,
  decision: 'approve' | 'reject',
  opts: { note?: string; confirmSelfApproval?: boolean },
  requestId?: string,
): Promise<DecideOutcome> {
  return db.transaction(async (tx) => {
    const [v] = await tx.query<{
      id: string;
      item_id: string;
      version: number;
      body: string;
      digest: string;
      status: string;
      proposed_by: string;
      expired: boolean;
      retired: boolean;
      in_brand_core: boolean;
      kind: string;
    }>(
      `SELECT v.id, v.item_id, v.version, v.body, v.digest, v.status, v.proposed_by,
              (v.expires_at IS NOT NULL AND v.expires_at <= now()) AS expired,
              (i.retired_at IS NOT NULL) AS retired, i.in_brand_core, i.kind
         FROM knowledge_versions v JOIN knowledge_items i ON i.id = v.item_id
        WHERE v.id = $1 AND v.restaurant_id = $2
        FOR UPDATE OF v, i`,
      [versionId, actor.restaurantId],
    );
    if (!v) return 'not_found';
    if (v.status !== 'proposed') return 'not_pending';
    if (v.retired) return 'retired';

    if (decision === 'reject') {
      await tx.query(
        `UPDATE knowledge_versions SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`,
        [v.id, actor.userId, opts.note ?? null],
      );
      await recordAudit(tx, {
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: 'knowledge.rejected',
        targetType: 'knowledge_version',
        targetId: v.id,
        details: { itemId: v.item_id, version: v.version, note: opts.note },
        requestId,
      });
      return 'rejected';
    }

    if (v.expired) return 'expired';
    const self = v.proposed_by === actor.userId;
    if (self && opts.confirmSelfApproval !== true) return 'needs_self_confirmation';
    if (v.in_brand_core && (await coreWords(tx, actor.restaurantId, v.item_id)) + countWords(v.body) > BRAND_CORE_MAX_WORDS) {
      return 'core_too_large';
    }

    await tx.query(
      `UPDATE knowledge_versions SET status = 'superseded', superseded_at = now() WHERE item_id = $1 AND status = 'approved'`,
      [v.item_id],
    );
    await tx.query(
      `UPDATE knowledge_versions SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`,
      [v.id, actor.userId, opts.note ?? null],
    );
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: self ? 'knowledge.self_approved' : 'knowledge.approved',
      targetType: 'knowledge_version',
      targetId: v.id,
      details: { itemId: v.item_id, kind: v.kind, version: v.version, digest: v.digest },
      requestId,
    });
    return self ? 'self_approved' : 'approved';
  });
}

export async function retireItem(
  db: Db,
  actor: AuthContext,
  itemId: string,
  reason: string,
  requestId?: string,
): Promise<'retired' | 'not_found' | 'already_retired'> {
  return db.transaction(async (tx) => {
    const [item] = await tx.query<{ retired_at: unknown }>(
      `SELECT retired_at FROM knowledge_items WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
      [itemId, actor.restaurantId],
    );
    if (!item) return 'not_found' as const;
    if (item.retired_at) return 'already_retired' as const;
    await tx.query(`UPDATE knowledge_items SET retired_at = now(), retired_by = $2, retire_reason = $3 WHERE id = $1`, [
      itemId,
      actor.userId,
      reason,
    ]);
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'knowledge.retired',
      targetType: 'knowledge_item',
      targetId: itemId,
      details: { reason },
      requestId,
    });
    return 'retired' as const;
  });
}

export async function setBrandCore(
  db: Db,
  actor: AuthContext,
  itemId: string,
  inBrandCore: boolean,
  requestId?: string,
): Promise<'ok' | 'not_found' | 'not_allowed' | 'core_too_large'> {
  return db.transaction(async (tx) => {
    const [item] = await tx.query<{ kind: string; in_brand_core: boolean }>(
      `SELECT kind, in_brand_core FROM knowledge_items WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
      [itemId, actor.restaurantId],
    );
    if (!item) return 'not_found' as const;
    if (inBrandCore && item.kind !== 'brand_rule' && item.kind !== 'fact') return 'not_allowed' as const;
    if (item.in_brand_core === inBrandCore) return 'ok' as const;
    if (inBrandCore) {
      const [cur] = await tx.query<{ body: string }>(
        `SELECT body FROM knowledge_versions WHERE item_id = $1 AND status = 'approved'`,
        [itemId],
      );
      if ((await coreWords(tx, actor.restaurantId)) + countWords(cur?.body ?? '') > BRAND_CORE_MAX_WORDS) {
        return 'core_too_large' as const;
      }
    }
    await tx.query(`UPDATE knowledge_items SET in_brand_core = $2 WHERE id = $1`, [itemId, inBrandCore]);
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: inBrandCore ? 'knowledge.added_to_core' : 'knowledge.removed_from_core',
      targetType: 'knowledge_item',
      targetId: itemId,
      requestId,
    });
    return 'ok' as const;
  });
}

export interface CoreEntry {
  itemId: string;
  versionId: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  sourceNote: string | null;
  expiresAt: string | null;
}

/**
 * The brand core: every approved, current, unexpired brand rule and fact marked for the core.
 * This is what the AI always receives. Ordered deterministically so the prompt prefix is stable.
 */
export async function getBrandCore(db: Db, restaurantId: string): Promise<{ entries: CoreEntry[]; words: number; maxWords: number }> {
  const rows = await db.query<{
    item_id: string;
    version_id: string;
    kind: KnowledgeKind;
    title: string;
    body: string;
    source_note: string | null;
    expires_at: Date | string | null;
  }>(
    `SELECT i.id AS item_id, v.id AS version_id, i.kind, i.title, v.body, v.source_note, v.expires_at
       FROM knowledge_items i JOIN knowledge_versions v ON v.item_id = i.id AND v.status = 'approved'
      WHERE i.restaurant_id = $1 AND i.in_brand_core AND i.retired_at IS NULL
        AND (v.expires_at IS NULL OR v.expires_at > now())
      ORDER BY i.kind, i.title, i.id`,
    [restaurantId],
  );
  const entries = rows.map((r) => ({
    itemId: r.item_id,
    versionId: r.version_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    sourceNote: r.source_note,
    expiresAt: iso(r.expires_at),
  }));
  return { entries, words: entries.reduce((n, e) => n + countWords(e.body), 0), maxWords: BRAND_CORE_MAX_WORDS };
}

export interface SectionHit {
  sectionId: string;
  versionId: string;
  itemId: string;
  kind: KnowledgeKind;
  title: string;
  heading: string;
  body: string;
  rank: number;
}

/** Turns a free-text question into an OR query of its meaningful words (natural questions rarely match every word). */
export function toOrQuery(q: string): string | null {
  const words = [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 24);
  return words.length > 0 ? words.join(' | ') : null;
}

/**
 * Full-text search over approved, current, unexpired sections only. Filtering happens in SQL
 * before ranking, so proposals, rejected, superseded, expired and retired content can never appear.
 */
export async function searchSections(
  db: Db,
  restaurantId: string,
  q: string,
  limit: number,
  kinds: KnowledgeKind[] = ['strategy', 'reference', 'brand_rule', 'fact'],
): Promise<SectionHit[]> {
  const query = toOrQuery(q);
  if (!query) return [];
  const rows = await db.query<{
    section_id: string;
    version_id: string;
    item_id: string;
    kind: KnowledgeKind;
    title: string;
    heading: string;
    body: string;
    rank: number;
  }>(
    `SELECT s.id AS section_id, v.id AS version_id, i.id AS item_id, i.kind, i.title, s.heading, s.body,
            ts_rank_cd(s.search, q.query) AS rank
       FROM knowledge_sections s
       JOIN knowledge_versions v ON v.id = s.version_id AND v.status = 'approved'
       JOIN knowledge_items i ON i.id = v.item_id
       CROSS JOIN (SELECT to_tsquery('english', $2) AS query) q
      WHERE s.restaurant_id = $1 AND i.retired_at IS NULL AND i.kind = ANY($4::text[])
        AND (v.expires_at IS NULL OR v.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM visual_standards vs WHERE vs.version_id = v.id)
        AND s.search @@ q.query
      ORDER BY rank DESC, s.id
      LIMIT $3`,
    [restaurantId, query, limit, kinds],
  );
  return rows.map((r) => ({
    sectionId: r.section_id,
    versionId: r.version_id,
    itemId: r.item_id,
    kind: r.kind,
    title: r.title,
    heading: r.heading,
    body: r.body,
    rank: Number(r.rank),
  }));
}
