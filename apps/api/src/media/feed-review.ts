import sharp from 'sharp';
import { feedReviewRequestSchema, feedReviewResultSchema, type SavedFeedEvaluation } from '@the-pocket/shared';
import type { RequestHandler } from 'express';
import { AiUnavailableError, callProvider, guard, type AiDeps } from '../ai/assistant.js';
import { brandCoreDocuments } from '../ai/context.js';
import { recordUsage } from '../ai/usage.js';
import { recordAudit } from '../audit.js';
import type { PolicyRouter } from '../policy.js';
import { visibleAsset } from './collections.js';
import { approvedVisualContext } from './standards.js';

const SYSTEM = 'Evaluate the supplied Instagram planning grid in image order, three images per row. Consider visual rhythm, light, color, repetition and brand fit. Use the supplied visual standards as data. Distinguish planned photos from manually supplied existing-feed photos. Suggest changes only to planned photos. The grid may omit published photos. Do not infer facts about the restaurant or ask to publish. Identify meaningful uncertainty.';

export function addFeedReviewRoute(router: PolicyRouter, deps: AiDeps, limit: RequestHandler) {
  router.get('/visual/feed-reviews', 'assistant.use', async (req, res) => {
    const actor = req.auth!;
    if (!actor.capabilities.includes('content.draft')) return res.status(403).json({ error: 'Photo access denied.' });
    const evaluations = await deps.db.query<SavedFeedEvaluation>(`SELECT e.id, e.layout_id AS "layoutId",
      e.layout_revision AS "layoutRevision", e.photos, e.result, e.created_at AS "createdAt"
      FROM feed_evaluations e
      WHERE e.restaurant_id = $1 AND e.user_id = $2 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(e.photos) item
        WHERE NOT EXISTS (SELECT 1 FROM visual_assets a
          WHERE a.id = (item->>'assetId')::uuid AND ${visibleAsset})
      )
      ORDER BY e.created_at DESC, e.id LIMIT 25`, [actor.restaurantId, actor.userId, actor.role === 'admin']);
    return res.json({ evaluations });
  });

  router.post('/visual/feed-review', 'assistant.use', limit, async (req, res) => {
    const input = feedReviewRequestSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Select two to nine distinct photos and confirm photo privacy.' });
    const actor = req.auth!;
    if (!actor.capabilities.includes('content.draft')) return res.status(403).json({ error: 'Photo access denied.' });
    if (deps.ai?.name !== 'mock') return res.status(503).json({ error: 'Feed review is available in practice mode.' });
    const { photos, layout } = input.data;
    if (layout) {
      const [saved] = await deps.db.query<{ revision: number; items: SavedFeedEvaluation['photos'] }>(`SELECT c.revision,
        (SELECT jsonb_agg(jsonb_build_object('assetId', i.asset_id, 'existingFeed', i.existing_feed) ORDER BY i.position)
          FROM visual_collection_items i WHERE i.collection_id = c.id) AS items
        FROM visual_collections c WHERE c.id = $4 AND c.restaurant_id = $1 AND c.kind = 'feed'
          AND (c.owner_id = $2 OR c.visibility = 'team' OR (c.visibility = 'management' AND $3::boolean))`,
      [actor.restaurantId, actor.userId, actor.role === 'admin', layout.id]);
      if (!saved) return res.status(404).json({ error: 'Layout unavailable.' });
      const entries = saved.items?.slice(0, 9) ?? [];
      if (saved.revision !== layout.revision || entries.length !== photos.length
        || entries.some((entry, i) => entry.assetId !== photos[i]?.assetId || entry.existingFeed !== photos[i]?.existingFeed)) {
        return res.status(409).json({ error: 'Save this exact layout before reviewing it.' });
      }
    }
    const assets = await deps.db.query<{ id: string; bytes: string }>(
      `SELECT a.id, encode(a.image_bytes, 'base64') AS bytes
      FROM visual_assets a WHERE ${visibleAsset} AND a.id = ANY($4::uuid[])`,
      [actor.restaurantId, actor.userId, actor.role === 'admin', photos.map((photo) => photo.assetId)],
    );
    if (assets.length !== photos.length) return res.status(404).json({ error: 'One or more photos are unavailable.' });
    try {
      const provider = await guard(deps, actor, 'photo_review');
      const byId = new Map(assets.map((asset) => [asset.id, asset.bytes]));
      const images = await Promise.all(photos.map(async (photo) => ({
        mediaType: 'image/jpeg' as const,
        bytes: await sharp(Buffer.from(byId.get(photo.assetId)!, 'base64'))
          .resize(360, 360, { fit: 'cover' }).jpeg().toBuffer(),
      })));
      const [documents, visualStandards] = await Promise.all([
        brandCoreDocuments(deps.db, actor.restaurantId), approvedVisualContext(deps.db, actor),
      ]);
      const output = await callProvider(deps, actor, 'photo_review', provider, () => provider.structured({
        system: SYSTEM, documents, images, effort: 'low', maxTokens: 1800, schema: feedReviewResultSchema,
        prompt: JSON.stringify({ gridColumns: 3, visualStandards,
          order: photos.map(({ existingFeed }, index) => ({ position: index + 1, existingFeed })) }),
        mock: () => ({ observations: [`Practice review received ${photos.length} photos in grid order.`],
          suggestions: ['Compare a food image next to an atmosphere image to assess variety.'],
          uncertainty: 'This practice example did not evaluate lighting, color, or photo content.' }),
      }));
      const checked = feedReviewResultSchema.safeParse(output.data);
      await recordUsage(deps.db, { restaurantId: actor.restaurantId, userId: actor.userId, task: 'photo_review',
        provider: provider.name, model: output.model, usage: output.usage,
        outcome: output.refused ? 'refused' : checked.success ? 'ok' : 'error' });
      if (output.refused || !checked.success) return res.status(422).json({ error: 'No valid review was returned.' });
      const evaluation = await deps.db.transaction(async (tx) => {
        const [saved] = await tx.query<Pick<SavedFeedEvaluation, 'id' | 'createdAt'>>(`INSERT INTO feed_evaluations
          (restaurant_id, user_id, layout_id, layout_revision, photos, visual_standards, result, provider)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) RETURNING id, created_at AS "createdAt"`,
        [actor.restaurantId, actor.userId, layout?.id ?? null, layout?.revision ?? null, JSON.stringify(photos),
          JSON.stringify(visualStandards.map((standard) => standard.versionId)), JSON.stringify(checked.data), provider.name]);
        await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId, action: 'visual.feed_evaluated',
          targetType: 'feed_evaluation', targetId: saved!.id, requestId: req.requestId });
        return saved!;
      });
      return res.json({ ...checked.data, simulated: true, evaluation: { ...evaluation, layoutId: layout?.id ?? null,
        layoutRevision: layout?.revision ?? null, photos, result: checked.data } });
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      return res.status(503).json({ error: 'Feed review is unavailable or its budget limit was reached.' });
    }
  });
}
