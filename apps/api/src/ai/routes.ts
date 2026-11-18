import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { askSchema, draftRequestSchema, type AssistantStatus } from '@the-pocket/shared';
import { badRequest } from '../knowledge/routes.js';
import type { PolicyRouter } from '../policy.js';
import { AiUnavailableError, ask, draft, type AiDeps } from './assistant.js';
import { usageSummary } from './usage.js';

const convParam = z.object({ conversationId: z.string().uuid() });

const UNAVAILABLE: Record<AiUnavailableError['reason'], [number, string]> = {
  disabled: [503, 'The marketing assistant is not set up yet. An administrator needs to add the AI service key.'],
  budget: [503, "This month's AI budget has been reached. An administrator can raise it, or it resets next month."],
  provider_error: [502, 'The assistant is not responding right now. Please try again in a minute.'],
};

function handleAiError(err: unknown, res: Response): boolean {
  if (err instanceof AiUnavailableError) {
    const [status, message] = UNAVAILABLE[err.reason];
    res.status(status).json({ error: message, reason: err.reason });
    return true;
  }
  return false;
}

export function addAssistantRoutes(r: PolicyRouter, deps: AiDeps, aiLimit: RequestHandler) {
  const { db } = deps;

  r.get('/assistant/status', 'member', (_req, res) => {
    const status: AssistantStatus = { available: deps.ai !== null, provider: deps.ai?.name ?? 'disabled' };
    res.json(status);
  });

  r.post('/assistant/ask', 'assistant.use', aiLimit, async (req, res) => {
    const b = askSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    try {
      const out = await ask(deps, req.auth!, b.data);
      if (out === 'not_found') res.status(404).json({ error: 'Conversation not found.' });
      else res.json(out);
    } catch (err) {
      if (!handleAiError(err, res)) throw err;
    }
  });

  r.get('/assistant/conversations', 'assistant.use', async (req, res) => {
    const a = req.auth!;
    const rows = await db.query(
      `SELECT id, title, created_at FROM conversations WHERE restaurant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [a.restaurantId, a.userId],
    );
    res.json({ conversations: rows });
  });

  r.get('/assistant/conversations/:conversationId', 'assistant.use', async (req, res) => {
    const p = convParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const a = req.auth!;
    const [conv] = await db.query<{ id: string; title: string }>(
      `SELECT id, title FROM conversations WHERE id = $1 AND restaurant_id = $2 AND user_id = $3`,
      [p.data.conversationId, a.restaurantId, a.userId],
    );
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const messages = await db.query(
      `SELECT id, role, content, sources, created_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY seq`,
      [conv.id],
    );
    res.json({ conversation: conv, messages });
  });

  r.post('/drafts/generate', 'content.draft', aiLimit, async (req, res) => {
    const b = draftRequestSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    try {
      res.json(await draft(deps, req.auth!, b.data));
    } catch (err) {
      if (!handleAiError(err, res)) throw err;
    }
  });

  r.get('/ai/usage', 'analytics.view_sensitive', async (req, res) => {
    res.json(await usageSummary(db, req.auth!.restaurantId, deps.budgetUsd, deps.ai?.name ?? 'disabled'));
  });
}
