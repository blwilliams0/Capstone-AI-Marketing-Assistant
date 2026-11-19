import type { Db } from '@the-pocket/db';
import type {
  ActivityEntry,
  ApprovalView,
  PersonRef,
  PostDetail,
  PostSource,
  PostStatus,
  PostSummary,
  PostVersionView,
  ReadyToPostCard,
} from '@the-pocket/shared';
import { recordAudit } from '../audit.js';
import type { AuthContext } from '../types.js';

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());
const person = (id: string | null, name: string | null): PersonRef | null => (id ? { id, name: name ?? '' } : null);

// ---------------------------------------------------------------------------------------------
// Rows

interface VersionRow {
  id: string;
  item_id: string;
  version: number;
  channel: PostVersionView['channel'];
  audience: PostVersionView['audience'];
  angle: string;
  caption: string;
  photo_plan: string;
  scheduled_for: Date | string | null;
  origin: PostVersionView['origin'];
  created_by: string;
  created_by_name: string;
  created_at: Date | string;
  digest: string;
  knowledge_version_ids: string[];
  sources_removed: string[];
}

const VERSION_SELECT = `
  SELECT v.id, v.item_id, v.version, v.channel, v.audience, v.angle, v.caption, v.photo_plan, v.scheduled_for,
         v.origin, v.created_by, p.name AS created_by_name, v.created_at, v.digest, v.knowledge_version_ids, v.sources_removed
    FROM content_versions v JOIN profiles p ON p.user_id = v.created_by`;

interface ApprovalRow {
  id: string;
  item_id: string;
  content_version_id: string;
  version: number;
  digest: string;
  status: ApprovalView['status'];
  requested_by: string;
  requested_by_name: string;
  requested_at: Date | string;
  request_note: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  decision_note: string | null;
  self_approved: boolean;
}

const APPROVAL_SELECT = `
  SELECT a.id, a.item_id, a.content_version_id, v.version, a.digest, a.status, a.requested_by, pr.name AS requested_by_name,
         a.requested_at, a.request_note, a.decided_by, pd.name AS decided_by_name, a.decided_at, a.decision_note, a.self_approved
    FROM approval_requests a
    JOIN content_versions v ON v.id = a.content_version_id
    JOIN profiles pr ON pr.user_id = a.requested_by
    LEFT JOIN profiles pd ON pd.user_id = a.decided_by`;

const toApproval = (r: ApprovalRow): ApprovalView => ({
  id: r.id,
  versionId: r.content_version_id,
  version: r.version,
  digest: r.digest,
  status: r.status,
  requestedBy: person(r.requested_by, r.requested_by_name)!,
  requestedAt: iso(r.requested_at)!,
  requestNote: r.request_note,
  decidedBy: person(r.decided_by, r.decided_by_name),
  decidedAt: iso(r.decided_at),
  decisionNote: r.decision_note,
  selfApproved: r.self_approved,
});

// ---------------------------------------------------------------------------------------------
// Knowledge sources: are the rules and facts a post relies on still current?

interface SourceRow {
  id: string;
  item_id: string;
  title: string;
  kind: string;
  status: string;
  expired: boolean;
  retired: boolean;
}

async function loadSources(db: Db, ids: string[]): Promise<Map<string, PostSource>> {
  const out = new Map<string, PostSource>();
  if (ids.length === 0) return out;
  const rows = await db.query<SourceRow>(
    `SELECT kv.id, kv.item_id, ki.title, ki.kind, kv.status,
            (kv.expires_at IS NOT NULL AND kv.expires_at <= now()) AS expired, (ki.retired_at IS NOT NULL) AS retired
       FROM knowledge_versions kv JOIN knowledge_items ki ON ki.id = kv.item_id
      WHERE kv.id = ANY($1::uuid[])`,
    [[...new Set(ids)]],
  );
  for (const r of rows) {
    const problem = r.retired
      ? `"${r.title}" has been retired`
      : r.expired
        ? `"${r.title}" has expired`
        : r.status !== 'approved'
          ? `"${r.title}" has been updated since this post was written`
          : null;
    out.set(r.id, { versionId: r.id, title: r.title, kind: r.kind, current: problem === null, problem });
  }
  return out;
}

const sourcesOf = (v: VersionRow, all: Map<string, PostSource>): PostSource[] =>
  v.knowledge_version_ids.map((id) => all.get(id)).filter((s): s is PostSource => !!s);

const blockersOf = (sources: PostSource[]): string[] =>
  sources
    .filter((s) => s.problem)
    .map((s) => `This post relies on knowledge that changed: ${s.problem}. Save an edit to update its sources, then get it approved again.`);

const toVersion = (r: VersionRow, all: Map<string, PostSource>): PostVersionView => ({
  id: r.id,
  version: r.version,
  channel: r.channel,
  audience: r.audience,
  angle: r.angle,
  caption: r.caption,
  photoPlan: r.photo_plan,
  scheduledFor: iso(r.scheduled_for),
  origin: r.origin,
  createdBy: person(r.created_by, r.created_by_name)!,
  createdAt: iso(r.created_at)!,
  digest: r.digest,
  sources: sourcesOf(r, all),
  removedSources: r.sources_removed.map((id) => all.get(id)).filter((s): s is PostSource => !!s),
});

/**
 * Keeps sources that are still current; replaces an outdated one with the current approved
 * version of the same knowledge item. Sources that were retired or have no current version are
 * removed, and returned separately so the new version records (and shows the approver) what the
 * text no longer has support for.
 */
async function refreshSources(tx: Db, restaurantId: string, ids: string[]): Promise<{ ids: string[]; removed: string[] }> {
  if (ids.length === 0) return { ids: [], removed: [] };
  const rows = await tx.query<{ old_id: string; cur_id: string | null }>(
    `SELECT old.id AS old_id, cur.id AS cur_id
       FROM knowledge_versions old
       JOIN knowledge_items ki ON ki.id = old.item_id
       LEFT JOIN knowledge_versions cur ON cur.item_id = old.item_id AND cur.status = 'approved'
            AND (cur.expires_at IS NULL OR cur.expires_at > now()) AND ki.retired_at IS NULL
      WHERE old.id = ANY($1::uuid[]) AND old.restaurant_id = $2`,
    [ids, restaurantId],
  );
  return {
    ids: [...new Set(rows.flatMap((r) => (r.cur_id ? [r.cur_id] : [])))],
    removed: rows.filter((r) => !r.cur_id).map((r) => r.old_id),
  };
}

/** The item's creator and the author of every version: all of them count as "self" when approving. */
async function authorsOf(tx: Db, itemId: string): Promise<Set<string>> {
  const rows = await tx.query<{ id: string }>(
    `SELECT created_by AS id FROM content_items WHERE id = $1 UNION SELECT created_by FROM content_versions WHERE item_id = $1`,
    [itemId],
  );
  return new Set(rows.map((r) => r.id));
}

/** Locks the post first (same order as edit, submit and archive), so concurrent actions queue cleanly. */
async function lockItemOfApproval(tx: Db, approvalId: string, restaurantId: string): Promise<boolean> {
  const [row] = await tx.query<{ item_id: string }>(`SELECT item_id FROM approval_requests WHERE id = $1 AND restaurant_id = $2`, [approvalId, restaurantId]);
  if (!row) return false;
  await tx.query(`SELECT 1 FROM content_items WHERE id = $1 FOR UPDATE`, [row.item_id]);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Status

function deriveStatus(args: {
  archived: boolean;
  posted: boolean;
  latestVersionId: string;
  latestApproval: { status: string; content_version_id: string } | undefined;
}): PostStatus {
  if (args.posted) return 'posted';
  if (args.archived) return 'archived';
  const a = args.latestApproval;
  if (!a || a.content_version_id !== args.latestVersionId) return 'draft';
  switch (a.status) {
    case 'pending':
      return 'in_review';
    case 'approved':
      return 'approved';
    case 'changes_requested':
      return 'changes_requested';
    case 'rejected':
      return 'rejected';
    default:
      return 'draft';
  }
}

// ---------------------------------------------------------------------------------------------
// Reads

interface ItemRow {
  id: string;
  title: string;
  created_by: string;
  created_by_name: string;
  created_at: Date | string;
  archived_at: Date | string | null;
}

const ITEM_SELECT = `
  SELECT i.id, i.title, i.created_by, p.name AS created_by_name, i.created_at, i.archived_at
    FROM content_items i JOIN profiles p ON p.user_id = i.created_by`;

export async function listPosts(db: Db, restaurantId: string, opts: { includeArchived?: boolean } = {}): Promise<PostSummary[]> {
  const items = await db.query<ItemRow>(`${ITEM_SELECT} WHERE i.restaurant_id = $1 ORDER BY i.created_at DESC LIMIT 200`, [restaurantId]);
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const latest = await db.query<VersionRow>(
    `SELECT DISTINCT ON (v.item_id) v.* FROM (${VERSION_SELECT} WHERE v.item_id = ANY($1::uuid[])) v ORDER BY v.item_id, v.version DESC`,
    [ids],
  );
  const approvals = await db.query<{ item_id: string; status: string; content_version_id: string; requested_at: Date | string; decided_at: Date | string | null }>(
    `SELECT DISTINCT ON (item_id) item_id, status, content_version_id, requested_at, decided_at
       FROM approval_requests WHERE item_id = ANY($1::uuid[]) ORDER BY item_id, requested_at DESC`,
    [ids],
  );
  const posts = await db.query<{ item_id: string; posted_at: Date | string }>(`SELECT item_id, posted_at FROM post_records WHERE item_id = ANY($1::uuid[])`, [ids]);
  const sources = await loadSources(db, latest.flatMap((v) => [...v.knowledge_version_ids, ...v.sources_removed]));

  const latestBy = new Map(latest.map((v) => [v.item_id, v]));
  const approvalBy = new Map(approvals.map((a) => [a.item_id, a]));
  const postBy = new Map(posts.map((p) => [p.item_id, p]));

  const out: PostSummary[] = [];
  for (const i of items) {
    const v = latestBy.get(i.id);
    if (!v) continue;
    const a = approvalBy.get(i.id);
    const p = postBy.get(i.id);
    const status = deriveStatus({ archived: i.archived_at !== null, posted: !!p, latestVersionId: v.id, latestApproval: a });
    if (status === 'archived' && !opts.includeArchived) continue;
    const times = [v.created_at, a?.requested_at, a?.decided_at, p?.posted_at].filter(Boolean).map((t) => new Date(t!).getTime());
    out.push({
      id: i.id,
      title: i.title,
      status,
      channel: v.channel,
      audience: v.audience,
      latestVersion: v.version,
      excerpt: v.caption.slice(0, 160),
      createdBy: person(i.created_by, i.created_by_name)!,
      updatedAt: new Date(Math.max(...times)).toISOString(),
      blockers: status === 'posted' || status === 'archived' ? [] : blockersOf(sourcesOf(v, sources)),
    });
  }
  return out;
}

interface EventRow {
  id: string;
  item_id: string;
  title: string;
  event: string;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  digest: string;
  created_at: Date | string;
}

const EVENT_SELECT = `
  SELECT e.id, e.item_id, i.title, e.event, e.actor_user_id, p.name AS actor_name, e.note, e.digest, e.created_at
    FROM approval_events e
    JOIN content_items i ON i.id = e.item_id
    LEFT JOIN profiles p ON p.user_id = e.actor_user_id`;

const toActivity = (r: EventRow): ActivityEntry => ({
  id: r.id,
  itemId: r.item_id,
  postTitle: r.title,
  event: r.event,
  actor: person(r.actor_user_id, r.actor_name),
  note: r.note,
  digest: r.digest,
  at: iso(r.created_at)!,
});

export async function getPost(db: Db, restaurantId: string, itemId: string): Promise<PostDetail | null> {
  const [item] = await db.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1 AND i.restaurant_id = $2`, [itemId, restaurantId]);
  if (!item) return null;
  const versions = await db.query<VersionRow>(`${VERSION_SELECT} WHERE v.item_id = $1 ORDER BY v.version DESC`, [itemId]);
  const approvals = await db.query<ApprovalRow>(`${APPROVAL_SELECT} WHERE a.item_id = $1 ORDER BY a.requested_at DESC`, [itemId]);
  const [post] = await db.query<{ posted_by: string; name: string; posted_at: Date | string; post_url: string | null; note: string | null; digest: string }>(
    `SELECT r.posted_by, p.name, r.posted_at, r.post_url, r.note, r.digest FROM post_records r JOIN profiles p ON p.user_id = r.posted_by WHERE r.item_id = $1`,
    [itemId],
  );
  const events = await db.query<EventRow>(`${EVENT_SELECT} WHERE e.item_id = $1 ORDER BY e.created_at, e.id`, [itemId]);
  const sources = await loadSources(db, versions.flatMap((v) => [...v.knowledge_version_ids, ...v.sources_removed]));

  const latest = versions[0]!;
  const open = approvals.find((a) => (a.status === 'pending' || a.status === 'approved') && a.content_version_id === latest.id) ?? null;
  const status = deriveStatus({ archived: item.archived_at !== null, posted: !!post, latestVersionId: latest.id, latestApproval: approvals[0] });
  return {
    id: item.id,
    title: item.title,
    status,
    createdBy: person(item.created_by, item.created_by_name)!,
    createdAt: iso(item.created_at)!,
    versions: versions.map((v) => toVersion(v, sources)),
    approvals: approvals.map(toApproval),
    openApproval: open ? toApproval(open) : null,
    post: post
      ? { postedBy: { id: post.posted_by, name: post.name }, postedAt: iso(post.posted_at)!, postUrl: post.post_url, note: post.note, digest: post.digest }
      : null,
    activity: events.map(toActivity),
    blockers: status === 'posted' || status === 'archived' ? [] : blockersOf(sourcesOf(latest, sources)),
  };
}

export async function readyToPost(db: Db, restaurantId: string): Promise<ReadyToPostCard[]> {
  const approvals = await db.query<ApprovalRow & { title: string }>(
    `SELECT x.*, i.title FROM (${APPROVAL_SELECT} WHERE a.restaurant_id = $1 AND a.status = 'approved') x
       JOIN content_items i ON i.id = x.item_id AND i.archived_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM post_records r WHERE r.approval_id = x.id)
      ORDER BY x.decided_at`,
    [restaurantId],
  );
  if (approvals.length === 0) return [];
  const versions = await db.query<VersionRow>(`${VERSION_SELECT} WHERE v.id = ANY($1::uuid[])`, [approvals.map((a) => a.content_version_id)]);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const sources = await loadSources(db, versions.flatMap((v) => [...v.knowledge_version_ids, ...v.sources_removed]));
  return approvals.map((a) => {
    const v = byId.get(a.content_version_id)!;
    const view = toVersion(v, sources);
    return {
      itemId: a.item_id,
      approvalId: a.id,
      title: a.title,
      version: view,
      approvedBy: person(a.decided_by, a.decided_by_name)!,
      approvedAt: iso(a.decided_at)!,
      selfApproved: a.self_approved,
      digest: a.digest,
      blockers: blockersOf(view.sources),
    };
  });
}

export async function listActivity(db: Db, restaurantId: string, limit = 100): Promise<ActivityEntry[]> {
  const rows = await db.query<EventRow>(`${EVENT_SELECT} WHERE e.restaurant_id = $1 ORDER BY e.created_at DESC, e.id LIMIT $2`, [restaurantId, limit]);
  return rows.map(toActivity);
}

// ---------------------------------------------------------------------------------------------
// Writes

export interface CreatePostInput {
  title?: string;
  channel: PostVersionView['channel'];
  audience: PostVersionView['audience'];
  angle?: string;
  caption: string;
  photoPlan?: string;
  scheduledFor?: string;
  sourceVersionIds: string[];
  origin: PostVersionView['origin'];
}

export async function createPost(db: Db, actor: AuthContext, input: CreatePostInput, requestId?: string): Promise<{ itemId: string; versionId: string } | 'invalid_sources'> {
  return db.transaction(async (tx) => {
    const ids = [...new Set(input.sourceVersionIds)];
    if (ids.length > 0) {
      const ok = await tx.query<{ id: string }>(
        `SELECT kv.id FROM knowledge_versions kv JOIN knowledge_items ki ON ki.id = kv.item_id
          WHERE kv.id = ANY($1::uuid[]) AND kv.restaurant_id = $2 AND kv.status = 'approved' AND ki.retired_at IS NULL`,
        [ids, actor.restaurantId],
      );
      if (ok.length !== ids.length) return 'invalid_sources' as const;
    }
    const title = (input.title || input.angle || input.caption.split('\n')[0] || 'Untitled post').slice(0, 120);
    const [item] = await tx.query<{ id: string }>(`INSERT INTO content_items (restaurant_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`, [
      actor.restaurantId,
      title,
      actor.userId,
    ]);
    const [v] = await tx.query<{ id: string; digest: string }>(
      `INSERT INTO content_versions (item_id, restaurant_id, version, channel, audience, angle, caption, photo_plan, scheduled_for, knowledge_version_ids, origin, created_by)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9::uuid[], $10, $11) RETURNING id, digest`,
      [item!.id, actor.restaurantId, input.channel, input.audience, input.angle ?? '', input.caption, input.photoPlan ?? '', input.scheduledFor ?? null, ids, input.origin, actor.userId],
    );
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'post.created',
      targetType: 'content_version',
      targetId: v!.id,
      details: { itemId: item!.id, version: 1, origin: input.origin, channel: input.channel, digest: v!.digest },
      requestId,
    });
    return { itemId: item!.id, versionId: v!.id };
  });
}

export interface EditPostInput {
  caption: string;
  angle?: string;
  photoPlan?: string;
  channel?: PostVersionView['channel'];
  audience?: PostVersionView['audience'];
  scheduledFor?: string | null;
}

export type EditOutcome = { versionId: string; version: number; supersededApproval: boolean } | 'not_found' | 'archived' | 'posted';

/** Saves an edit as a new version. Any waiting or approved request is superseded by the database. */
export async function editPost(db: Db, actor: AuthContext, itemId: string, input: EditPostInput, requestId?: string): Promise<EditOutcome> {
  return db.transaction(async (tx) => {
    const [item] = await tx.query<{ archived_at: unknown }>(`SELECT archived_at FROM content_items WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`, [
      itemId,
      actor.restaurantId,
    ]);
    if (!item) return 'not_found' as const;
    if (item.archived_at) return 'archived' as const;
    if ((await tx.query(`SELECT 1 FROM post_records WHERE item_id = $1`, [itemId])).length) return 'posted' as const;
    const [prev] = await tx.query<VersionRow>(`${VERSION_SELECT} WHERE v.item_id = $1 ORDER BY v.version DESC LIMIT 1`, [itemId]);
    const open = await tx.query(`SELECT 1 FROM approval_requests WHERE item_id = $1 AND status IN ('pending', 'approved')`, [itemId]);
    const { ids: sources, removed } = await refreshSources(tx, actor.restaurantId, prev!.knowledge_version_ids);
    const next = prev!.version + 1;
    const [v] = await tx.query<{ id: string; digest: string }>(
      `INSERT INTO content_versions (item_id, restaurant_id, version, channel, audience, angle, caption, photo_plan, scheduled_for, knowledge_version_ids, sources_removed, origin, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[], $12::uuid[], 'human', $11) RETURNING id, digest`,
      [
        itemId,
        actor.restaurantId,
        next,
        input.channel ?? prev!.channel,
        input.audience ?? prev!.audience,
        input.angle ?? prev!.angle,
        input.caption,
        input.photoPlan ?? prev!.photo_plan,
        input.scheduledFor === undefined ? prev!.scheduled_for : input.scheduledFor,
        sources,
        actor.userId,
        removed,
      ],
    );
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'post.edited',
      targetType: 'content_version',
      targetId: v!.id,
      details: { itemId, version: next, digest: v!.digest, supersededApproval: open.length > 0 },
      requestId,
    });
    return { versionId: v!.id, version: next, supersededApproval: open.length > 0 };
  });
}

export type SubmitOutcome = { approvalId: string; digest: string } | 'not_found' | 'archived' | 'posted' | 'already_open';

export async function submitPost(db: Db, actor: AuthContext, itemId: string, note: string | undefined, requestId?: string): Promise<SubmitOutcome> {
  return db.transaction(async (tx) => {
    const [item] = await tx.query<{ archived_at: unknown }>(`SELECT archived_at FROM content_items WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`, [
      itemId,
      actor.restaurantId,
    ]);
    if (!item) return 'not_found' as const;
    if (item.archived_at) return 'archived' as const;
    if ((await tx.query(`SELECT 1 FROM post_records WHERE item_id = $1`, [itemId])).length) return 'posted' as const;
    if ((await tx.query(`SELECT 1 FROM approval_requests WHERE item_id = $1 AND status IN ('pending', 'approved')`, [itemId])).length) {
      return 'already_open' as const;
    }
    const [latest] = await tx.query<{ id: string }>(`SELECT id FROM content_versions WHERE item_id = $1 ORDER BY version DESC LIMIT 1`, [itemId]);
    const [a] = await tx.query<{ id: string; digest: string }>(
      `INSERT INTO approval_requests (restaurant_id, item_id, content_version_id, requested_by, request_note) VALUES ($1, $2, $3, $4, $5) RETURNING id, digest`,
      [actor.restaurantId, itemId, latest!.id, actor.userId, note ?? null],
    );
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'post.submitted',
      targetType: 'approval_request',
      targetId: a!.id,
      details: { itemId, versionId: latest!.id, digest: a!.digest },
      requestId,
    });
    return { approvalId: a!.id, digest: a!.digest };
  });
}

export type DecisionOutcome =
  | 'approved'
  | 'self_approved'
  | 'rejected'
  | 'changes_requested'
  | 'not_found'
  | 'not_pending'
  | 'self_not_allowed'
  | 'needs_self_confirmation'
  | 'stale_sources';

/**
 * Decides a pending request. The caller must hold post.approve. Approving a post you submitted or
 * wrote is allowed only for administrators, with explicit confirmation; the database enforces the
 * same rule independently.
 */
export async function decidePost(
  db: Db,
  actor: AuthContext,
  approvalId: string,
  decision: 'approve' | 'reject' | 'request_changes',
  opts: { note?: string; confirmSelfApproval?: boolean },
  requestId?: string,
): Promise<DecisionOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockItemOfApproval(tx, approvalId, actor.restaurantId))) return 'not_found' as const;
    const [a] = await tx.query<{ id: string; item_id: string; status: string; requested_by: string; digest: string; knowledge_version_ids: string[] }>(
      `SELECT a.id, a.item_id, a.status, a.requested_by, a.digest, v.knowledge_version_ids
         FROM approval_requests a JOIN content_versions v ON v.id = a.content_version_id
        WHERE a.id = $1 AND a.restaurant_id = $2 FOR UPDATE OF a`,
      [approvalId, actor.restaurantId],
    );
    if (!a) return 'not_found' as const;
    if (a.status !== 'pending') return 'not_pending' as const;

    const base = { restaurantId: actor.restaurantId, actorUserId: actor.userId, targetType: 'approval_request', targetId: a.id, requestId };
    if (decision !== 'approve') {
      const status = decision === 'reject' ? 'rejected' : 'changes_requested';
      await tx.query(`UPDATE approval_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [
        a.id,
        status,
        actor.userId,
        opts.note ?? null,
      ]);
      await recordAudit(tx, { ...base, action: `post.${status}`, details: { itemId: a.item_id, digest: a.digest, note: opts.note } });
      return status;
    }

    const self = a.requested_by === actor.userId || (await authorsOf(tx, a.item_id)).has(actor.userId);
    if (self && actor.role !== 'admin') return 'self_not_allowed' as const;
    if (self && opts.confirmSelfApproval !== true) return 'needs_self_confirmation' as const;
    const sources = await loadSources(tx, a.knowledge_version_ids);
    if ([...sources.values()].some((s) => s.problem)) return 'stale_sources' as const;

    await tx.query(
      `UPDATE approval_requests SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3, self_approved = $4 WHERE id = $1`,
      [a.id, actor.userId, opts.note ?? null, self],
    );
    await recordAudit(tx, { ...base, action: self ? 'post.self_approved' : 'post.approved', details: { itemId: a.item_id, digest: a.digest } });
    return self ? ('self_approved' as const) : ('approved' as const);
  });
}

export async function withdrawRequest(db: Db, actor: AuthContext, approvalId: string, requestId?: string): Promise<'withdrawn' | 'not_found' | 'not_pending' | 'not_yours'> {
  return db.transaction(async (tx) => {
    const [a] = await tx.query<{ id: string; item_id: string; status: string; requested_by: string }>(
      `SELECT id, item_id, status, requested_by FROM approval_requests WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
      [approvalId, actor.restaurantId],
    );
    if (!a) return 'not_found' as const;
    if (a.status !== 'pending') return 'not_pending' as const;
    if (a.requested_by !== actor.userId && actor.role !== 'admin') return 'not_yours' as const;
    await tx.query(`UPDATE approval_requests SET status = 'withdrawn', closed_by = $2, closed_at = now() WHERE id = $1`, [a.id, actor.userId]);
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'post.withdrawn',
      targetType: 'approval_request',
      targetId: a.id,
      details: { itemId: a.item_id },
      requestId,
    });
    return 'withdrawn' as const;
  });
}

/** Archiving cancels other people's requests, so only the post's creator or a reviewer may do it. */
export async function archivePost(
  db: Db,
  actor: AuthContext,
  itemId: string,
  requestId?: string,
): Promise<'archived' | 'not_found' | 'already_archived' | 'posted' | 'not_allowed'> {
  return db.transaction(async (tx) => {
    const [item] = await tx.query<{ archived_at: unknown; created_by: string }>(
      `SELECT archived_at, created_by FROM content_items WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
      [itemId, actor.restaurantId],
    );
    if (!item) return 'not_found' as const;
    if (item.created_by !== actor.userId && !actor.capabilities.includes('post.approve')) return 'not_allowed' as const;
    if (item.archived_at) return 'already_archived' as const;
    if ((await tx.query(`SELECT 1 FROM post_records WHERE item_id = $1`, [itemId])).length) return 'posted' as const;
    await tx.query(`UPDATE approval_requests SET status = 'withdrawn', closed_by = $2, closed_at = now() WHERE item_id = $1 AND status = 'pending'`, [
      itemId,
      actor.userId,
    ]);
    await tx.query(`UPDATE approval_requests SET status = 'superseded', closed_by = $2, closed_at = now() WHERE item_id = $1 AND status = 'approved'`, [
      itemId,
      actor.userId,
    ]);
    await tx.query(`UPDATE content_items SET archived_at = now(), archived_by = $2 WHERE id = $1`, [itemId, actor.userId]);
    await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId, action: 'post.archived', targetType: 'content_item', targetId: itemId, requestId });
    return 'archived' as const;
  });
}

export type MarkPostedOutcome = 'posted' | 'not_found' | 'not_approved' | 'already_posted' | 'digest_mismatch' | 'stale_sources' | 'archived';

/**
 * Records that a person published the approved text by hand. The fingerprint they were shown must
 * match the approval, so a stale browser tab cannot record a post of different text.
 */
export async function markPosted(
  db: Db,
  actor: AuthContext,
  approvalId: string,
  input: { digest: string; postUrl?: string; note?: string },
  requestId?: string,
): Promise<MarkPostedOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockItemOfApproval(tx, approvalId, actor.restaurantId))) return 'not_found' as const;
    const [a] = await tx.query<{ id: string; item_id: string; status: string; digest: string; content_version_id: string; knowledge_version_ids: string[]; archived: boolean }>(
      `SELECT a.id, a.item_id, a.status, a.digest, a.content_version_id, v.knowledge_version_ids, (i.archived_at IS NOT NULL) AS archived
         FROM approval_requests a
         JOIN content_versions v ON v.id = a.content_version_id
         JOIN content_items i ON i.id = a.item_id
        WHERE a.id = $1 AND a.restaurant_id = $2 FOR UPDATE OF a`,
      [approvalId, actor.restaurantId],
    );
    if (!a) return 'not_found' as const;
    if ((await tx.query(`SELECT 1 FROM post_records WHERE approval_id = $1`, [a.id])).length) return 'already_posted' as const;
    if (a.archived) return 'archived' as const;
    if (a.status !== 'approved') return 'not_approved' as const;
    if (a.digest !== input.digest) return 'digest_mismatch' as const;
    const sources = await loadSources(tx, a.knowledge_version_ids);
    if ([...sources.values()].some((s) => s.problem)) return 'stale_sources' as const;
    await tx.query(
      `INSERT INTO post_records (restaurant_id, item_id, approval_id, content_version_id, posted_by, post_url, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.restaurantId, a.item_id, a.id, a.content_version_id, actor.userId, input.postUrl ?? null, input.note ?? null],
    );
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'post.posted',
      targetType: 'approval_request',
      targetId: a.id,
      details: { itemId: a.item_id, digest: a.digest, postUrl: input.postUrl },
      requestId,
    });
    return 'posted' as const;
  });
}
