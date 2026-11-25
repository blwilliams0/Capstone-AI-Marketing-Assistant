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
}
