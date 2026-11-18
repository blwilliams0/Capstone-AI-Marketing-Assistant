import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import { inviteRequestSchema, revokeRequestSchema, type MeResponse } from '@the-pocket/shared';
import { recordAudit } from './audit.js';
import type { AuthAdmin } from './auth/auth-admin.js';
import { PolicyRouter } from './policy.js';
import { addKnowledgeRoutes } from './knowledge/routes.js';
import { addAssistantRoutes } from './ai/routes.js';
import type { AiProvider } from './ai/provider.js';

export interface RouteDeps {
  db: Db;
  /** Absent when SUPABASE_SECRET_KEY is not configured; invitations then answer 503. */
  authAdmin?: AuthAdmin;
  /** null: AI routes answer 503 (no provider configured). */
  ai: AiProvider | null;
  aiBudgetUsd: number;
  /** Extra per-user limit for routes that call the AI (they cost money). */
  aiLimit: RequestHandler;
}

const idParam = z.object({ id: z.string().uuid() });
const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

function badRequest(res: Response, error: z.ZodError) {
  res.status(400).json({
    error: 'Some details are missing or invalid.',
    problems: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

export function buildRoutes(deps: RouteDeps): PolicyRouter {
  const { db, authAdmin } = deps;
  const r = new PolicyRouter();

  r.get('/me', 'member', (req, res) => {
    const a = req.auth!;
    const me: MeResponse = {
      userId: a.userId,
      email: a.email,
      name: a.name,
      restaurantId: a.restaurantId,
      role: a.role,
      capabilities: [...a.capabilities],
    };
    res.json(me);
  });

  r.get('/admin/members', 'users.manage', async (req, res) => {
    const members = await db.query(
      `SELECT m.id, p.email, p.name, m.role, m.status, m.created_at
         FROM memberships m JOIN profiles p ON p.user_id = m.user_id
        WHERE m.restaurant_id = $1 ORDER BY m.created_at`,
      [req.auth!.restaurantId],
    );
    res.json({ members });
  });

  r.post('/admin/invitations', 'users.invite', async (req, res) => {
    const parsed = inviteRequestSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    if (!authAdmin) {
      res.status(503).json({ error: 'Invitations are not set up yet. The server needs its Supabase secret key.' });
      return;
    }
    const actor = req.auth!;
    const { email, name, role } = parsed.data;

    const existing = await db.query(
      `SELECT 1 FROM memberships m JOIN profiles p ON p.user_id = m.user_id
        WHERE m.restaurant_id = $1 AND lower(p.email) = $2`,
      [actor.restaurantId, email],
    );
    if (existing.length > 0) {
      res.status(409).json({ error: 'That person already has (or previously had) access.' });
      return;
    }

    let userId: string;
    try {
      ({ userId } = await authAdmin.inviteUserByEmail(email, name));
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'invite failed', requestId: req.requestId, error: String(err) }),
      );
      res.status(502).json({ error: 'The invitation email could not be sent. Please try again.' });
      return;
    }

    const membershipId = await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
        [userId, email, name],
      );
      const [m] = await tx.query<{ id: string }>(
        `INSERT INTO memberships (restaurant_id, user_id, role, status, invited_by)
         VALUES ($1, $2, $3, 'invited', $4) RETURNING id`,
        [actor.restaurantId, userId, role, actor.userId],
      );
      const id = m!.id;
      await tx.query(
        `INSERT INTO permission_events (restaurant_id, membership_id, actor_user_id, event, new_role)
         VALUES ($1, $2, $3, 'invited', $4)`,
        [actor.restaurantId, id, actor.userId, role],
      );
      await recordAudit(tx, {
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: 'member.invited',
        targetType: 'membership',
        targetId: id,
        details: { email, role },
        requestId: req.requestId,
      });
      return id;
    });

    res.status(201).json({ membershipId, email, role, status: 'invited' });
  });

  r.post('/admin/members/:id/revoke', 'users.manage', async (req, res) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error);
    const body = revokeRequestSchema.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error);
    const actor = req.auth!;
    const targetId = params.data.id;

    const outcome = await db.transaction(async (tx) => {
      // Lock the restaurant's admins so two concurrent revocations cannot remove the last one.
      const admins = await tx.query<{ id: string }>(
        `SELECT id FROM memberships WHERE restaurant_id = $1 AND role = 'admin' AND status = 'active' FOR UPDATE`,
        [actor.restaurantId],
      );
      const [target] = await tx.query<{ id: string; role: string; status: string }>(
        `SELECT id, role, status FROM memberships WHERE id = $1 AND restaurant_id = $2`,
        [targetId, actor.restaurantId],
      );
      if (!target) return 'not_found' as const;
      if (target.status === 'revoked') return 'already_revoked' as const;
      if (target.role === 'admin' && target.status === 'active' && admins.filter((a) => a.id !== target.id).length === 0) {
        return 'last_admin' as const;
      }
      await tx.query(
        `UPDATE memberships SET status = 'revoked', revoked_at = now(), revoked_by = $1, revoke_reason = $2 WHERE id = $3`,
        [actor.userId, body.data.reason, target.id],
      );
      await tx.query(
        `INSERT INTO permission_events (restaurant_id, membership_id, actor_user_id, event, old_role, reason)
         VALUES ($1, $2, $3, 'revoked', $4, $5)`,
        [actor.restaurantId, target.id, actor.userId, target.role, body.data.reason],
      );
      await recordAudit(tx, {
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: 'member.revoked',
        targetType: 'membership',
        targetId: target.id,
        details: { reason: body.data.reason },
        requestId: req.requestId,
      });
      return 'revoked' as const;
    });

    switch (outcome) {
      case 'not_found':
        res.status(404).json({ error: 'Member not found.' });
        return;
      case 'already_revoked':
        res.status(409).json({ error: 'That member has already been removed.' });
        return;
      case 'last_admin':
        res.status(409).json({ error: 'You cannot remove the last administrator.' });
        return;
      case 'revoked':
        res.json({ status: 'revoked' });
    }
  });

  r.get('/audit-events', 'audit.view', async (req, res) => {
    const q = auditQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    const events = await db.query(
      `SELECT id, actor_user_id, action, target_type, target_id, details, request_id, created_at
         FROM audit_events WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.auth!.restaurantId, q.data.limit],
    );
    res.json({ events });
  });

  addKnowledgeRoutes(r, db);
  addAssistantRoutes(r, { db, ai: deps.ai, budgetUsd: deps.aiBudgetUsd }, deps.aiLimit);

  return r;
}
