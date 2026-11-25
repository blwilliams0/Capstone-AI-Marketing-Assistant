import { z } from 'zod';
import { createItemTx } from '../knowledge/service.js';
import { advisorFeedbackSchema, advisorPreferenceSchema, defaultAdvisorPreference, type AdvisorPreference } from '@the-pocket/shared';
import type { Db } from '@the-pocket/db';
import type { AuthContext } from '../types.js';
import type { PolicyRouter } from '../policy.js';
import { recordAudit } from '../audit.js';

export async function readAdvisorPreference(db: Db, actor: AuthContext): Promise<AdvisorPreference> {
  const [row] = await db.query<AdvisorPreference>(
    'SELECT enabled, detail, workflow FROM advisor_preferences WHERE restaurant_id = $1 AND user_id = $2',
    [actor.restaurantId, actor.userId],
  );
  return row ?? defaultAdvisorPreference;
}

export function addMemoryRoutes(router: PolicyRouter, db: Db) {
  router.get('/assistant/preferences', 'assistant.use', async (req, res) => {
    return res.json({ preference: await readAdvisorPreference(db, req.auth!) });
  });

  router.post('/assistant/preferences', 'assistant.use', async (req, res) => {
    const checked = advisorPreferenceSchema.safeParse(req.body);
    if (!checked.success) return res.status(400).json({ error: 'Invalid working preferences.' });
    const actor = req.auth!;
    const preference = checked.data;
    // A disabled, default preference removes the row entirely.
    if (!preference.enabled && preference.detail === 'standard' && preference.workflow === 'none') {
      await db.query('DELETE FROM advisor_preferences WHERE restaurant_id = $1 AND user_id = $2', [actor.restaurantId, actor.userId]);
    } else {
      await db.query(`INSERT INTO advisor_preferences (restaurant_id, user_id, enabled, detail, workflow)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (restaurant_id, user_id) DO UPDATE SET enabled = EXCLUDED.enabled, detail = EXCLUDED.detail, workflow = EXCLUDED.workflow`,
      [actor.restaurantId, actor.userId, preference.enabled, preference.detail, preference.workflow]);
    }
    return res.json({ preference });
  });

  router.post('/assistant/feedback', 'assistant.use', async (req, res) => {
    const checked = advisorFeedbackSchema.safeParse(req.body);
    if (!checked.success) return res.status(400).json({ error: 'Invalid feedback.' });
    const actor = req.auth!;
    const value = checked.data;
    const result = await db.transaction(async (tx) => {
      const relation = value.conversationId ? 'conversations' : 'visual_reviews';
      if (!(await tx.query(`SELECT id FROM ${relation} WHERE id = $1 AND restaurant_id = $2 AND user_id = $3`,
        [value.conversationId ?? value.reviewId, actor.restaurantId, actor.userId])).length) return null;
      const [saved] = await tx.query<{ id: string }>(
        `INSERT INTO advisor_feedback (restaurant_id, user_id, conversation_id, visual_review_id, rating, note)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [actor.restaurantId, actor.userId, value.conversationId ?? null, value.reviewId ?? null, value.rating, value.note ?? null],
      );
      await recordAudit(tx, { action: 'advisor.feedback_saved', restaurantId: actor.restaurantId, actorUserId: actor.userId,
        targetType: 'advisor_feedback', targetId: saved!.id, requestId: req.requestId });
      return saved;
    });
    if (!result) return res.status(404).json({ error: 'Conversation or review unavailable.' });
    return res.status(201).json(result);
  });

  router.post('/assistant/feedback/:id/propose', 'knowledge.propose', async (req, res) => {
    const validated = z.object({
      id: z.uuid(), title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(2000),
      evidence: z.string().trim().max(400).optional(), shareConfirmed: z.literal(true),
    }).safeParse({ ...req.body, id: req.params.id });
    if (!validated.success) return res.status(400).json({ error: 'Enter standalone guidance and explicitly confirm sharing.' });
    const actor = req.auth!;
    const { id, title, body, evidence } = validated.data;
    const result = await db.transaction(async (tx) => {
      // Lock the source so retrying the same submission cannot create duplicate proposals.
      const [source] = await tx.query(`SELECT id FROM advisor_feedback WHERE id = $1
        AND restaurant_id = $2 AND user_id = $3 FOR UPDATE`, [id, actor.restaurantId, actor.userId]);
      if (!source) return 'missing';
      const [prior] = await tx.query<{ itemId: string; versionId: string }>(`SELECT details->>'itemId' AS "itemId", target_id AS "versionId"
        FROM audit_events WHERE restaurant_id = $1 AND actor_user_id = $2 AND action = 'advisor.learning_proposed'
          AND details->>'feedbackId' = $3`, [actor.restaurantId, actor.userId, id]);
      if (prior) return prior;
      const item = await createItemTx(tx, actor, { kind: 'brand_rule', title, body,
        sourceNote: evidence ? `Staff-submitted evidence: ${evidence}` : 'Staff-submitted learning proposal' }, req.requestId);
      await recordAudit(tx, { action: 'advisor.learning_proposed', restaurantId: actor.restaurantId, actorUserId: actor.userId,
        targetType: 'knowledge_version', targetId: item.versionId, details: { itemId: item.itemId, feedbackId: id }, requestId: req.requestId });
      return item;
    });
    if (result === 'missing') return res.status(404).json({ error: 'Feedback unavailable.' });
    return res.status(201).json(result);
  });

  router.get('/assistant/learnings', 'brand.approve', async (req, res) => {
    const { restaurantId } = req.auth!;
    const entries = await db.query<{ itemId: string }>(`SELECT details->>'itemId' AS "itemId" FROM audit_events
      WHERE restaurant_id = $1 AND action = 'advisor.learning_proposed'
      ORDER BY created_at DESC LIMIT 100`, [restaurantId]);
    return res.json({ itemIds: entries.map((item) => item.itemId) });
  });

}
