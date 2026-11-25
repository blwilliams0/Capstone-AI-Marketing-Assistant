import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import { visualUploadSchema, visualReviewSchema, visualReviewResultSchema, type VisualAsset } from '@the-pocket/shared';
import { recordAudit } from '../audit.js';
import { guard, callProvider, AiUnavailableError, type AiDeps } from '../ai/assistant.js';
import { recordUsage } from '../ai/usage.js';
import { brandCoreDocuments } from '../ai/context.js';
import type { PolicyRouter } from '../policy.js';
import { visibleAsset } from './collections.js';
import { normalizePracticePhoto } from './local.js';
import { MEDIA_MAX_BYTES, MEDIA_TYPES, sha256Hex } from './store.js';

const summary = 'id, parent_id AS "parentId", label, sha256, created_at AS "createdAt", edits';
const owner = 'restaurant_id = $1 AND owner_id = $2';
const idParam = z.object({ id: z.uuid() });
const previewQuery = z.object({ size: z.enum(['thumb', 'full']).default('full') });
const parsePhoto = express.raw({ type: Object.keys(MEDIA_TYPES), limit: MEDIA_MAX_BYTES, inflate: false });

export function addVisualRoutes(router: PolicyRouter, deps: AiDeps, aiLimit: RequestHandler) {
  const { db } = deps;
  router.get('/visual/assets', 'content.draft', async (req, res) => {
    const actor = req.auth!;
    const assets = await db.query<VisualAsset>(`SELECT ${summary}, a.owner_id = $2 AS "owned" FROM visual_assets a WHERE ${visibleAsset} ORDER BY created_at DESC, id DESC`, [actor.restaurantId, actor.userId, actor.role === 'admin']);
    res.json({ assets });
  });

  router.post('/visual/assets', 'content.draft', (req, res, next) => {
    parsePhoto(req, res, (error?: { type?: string }) => {
      if (!error) return next();
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Use a supported image up to 10 MB.' });
    });
  }, async (req, res) => {
    let edits: unknown;
    let labelHeader: string;
    try {
      labelHeader = decodeURIComponent(req.get('x-photo-label') ?? '');
      const raw = req.get('x-photo-edits');
      if (raw) edits = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid photo adjustments.' });
    }
    const info = visualUploadSchema.safeParse({
      id: req.get('x-photo-id'), label: labelHeader,
      parentId: req.get('x-photo-parent'), mediaType: req.get('content-type'), edits,
    });
    if (!info.success || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Invalid photo upload.' });
    }
    const actor = req.auth!;
    const { id, parentId, label, mediaType } = info.data;
    const key = [actor.restaurantId, actor.userId];
    const inputSha = sha256Hex(req.body);
    const normalized = await normalizePracticePhoto(req.body, MEDIA_TYPES[mediaType]);
    if (!normalized || normalized.length > MEDIA_MAX_BYTES) return res.status(400).json({ error: 'Use a valid still photo under 16 megapixels and 10 MB.' });
    const result = await db.transaction(async (tx) => {
      // Serialize quota and idempotency checks for this owner.
      await tx.query('SELECT user_id FROM profiles WHERE user_id = $1 FOR UPDATE', [actor.userId]);
      const [existing] = await tx.query<VisualAsset & { input_sha256: string; media_type: string }>(
        `SELECT ${summary}, input_sha256, media_type FROM visual_assets WHERE ${owner} AND id = $3`, [...key, id],
      );
      if (existing) {
        const { input_sha256, media_type, ...asset } = existing;
        const recipe = info.data.edits;
        const sameRecipe = recipe
          ? Object.entries(recipe).every(([field, value]) => asset.edits?.[field as keyof typeof recipe] === value)
          : !asset.edits;
        return input_sha256 === inputSha && media_type === mediaType && asset.label === label
          && asset.parentId === (parentId ?? null) && sameRecipe ? { asset, inserted: false } : 'conflict';
      }
      if (parentId && !(await tx.query(`SELECT id FROM visual_assets WHERE ${owner} AND id = $3`, [...key, parentId])).length) return 'missing';
      const presetVersionId = info.data.edits?.presetVersionId;
      if (presetVersionId && !(await tx.query(`SELECT 1 FROM visual_standards s JOIN knowledge_versions v ON v.id = s.version_id
        WHERE s.version_id = $1 AND s.restaurant_id = $2 AND s.kind = 'preset' AND v.status IN ('approved','superseded')`,
      [presetVersionId, actor.restaurantId])).length) return 'preset';
      const [quota] = await tx.query<{ count: number; bytes: string }>(
        `SELECT count(*)::int AS count, coalesce(sum(octet_length(image_bytes)),0) AS bytes FROM visual_assets WHERE ${owner}`, key,
      );
      if (quota!.count >= 100 || Number(quota!.bytes) + normalized.length > 100 * 1024 * 1024) return 'quota';
      const [asset] = await tx.query<VisualAsset>(
        `INSERT INTO visual_assets (restaurant_id, owner_id, id, parent_id, label, media_type, input_sha256, image_bytes, edits)
         VALUES ($1,$2,$3,$4,$5,$6,$7,decode($8,'base64'),$9::jsonb)
         ON CONFLICT (id) DO NOTHING RETURNING ${summary}`,
        [...key, id, parentId ?? null, label, mediaType, inputSha, normalized.toString('base64'), info.data.edits ? JSON.stringify(info.data.edits) : null],
      );
      if (!asset) return 'conflict';
      await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId,
        action: 'visual.asset_added', targetType: 'visual_asset', targetId: id, details: { parentId, sha256: asset.sha256 }, requestId: req.requestId });
      return { asset, inserted: true };
    });
    if (result === 'missing') return res.status(404).json({ error: 'Source photo unavailable.' });
    if (result === 'preset') return res.status(400).json({ error: 'Preset version is unavailable.' });
    if (result === 'quota') return res.status(409).json({ error: 'This practice library has reached its storage limit.' });
    if (result === 'conflict') return res.status(409).json({ error: 'This upload identifier is already in use.' });
    return res.status(result.inserted ? 201 : 200).json(result.asset);
  });

  router.get('/visual/assets/:id/image', 'content.draft', async (req, res) => {
    const params = idParam.safeParse(req.params);
    const query = previewQuery.safeParse(req.query);
    if (!params.success || !query.success) return res.status(400).json({ error: 'Invalid image request.' });
    const actor = req.auth!;
    const [asset] = await db.query<{ bytes: string; media_type: string }>(
      `SELECT encode(image_bytes, 'base64') AS bytes, media_type FROM visual_assets a WHERE ${visibleAsset} AND a.id = $4`,
      [actor.restaurantId, actor.userId, actor.role === 'admin', params.data.id],
    );
    if (!asset) return res.status(404).json({ error: 'Photo unavailable.' });
    const bytes = Buffer.from(asset.bytes, 'base64');
    res.set('Cache-Control', 'private, no-store');
    if (query.data.size === 'thumb') {
      return res.type('image/webp').send(await sharp(bytes).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer());
    }
    return res.type(asset.media_type).send(bytes);
  });

  router.get('/visual/reviews', 'assistant.use', async (req, res) => {
    const actor = req.auth!;
    const rawId = idParam.safeParse({ id: req.query.assetId });
    if (!rawId.success) return res.status(400).json({ error: 'Choose an image.' });
    const reviews = await db.query(`SELECT v.id, v.result, v.simulated, v.created_at AS "createdAt", (SELECT count(*)::int FROM visual_review_assets y WHERE y.review_id = v.id) AS "assetCount"
      FROM visual_reviews v JOIN visual_review_assets x ON x.review_id = v.id
      WHERE v.restaurant_id = $1 AND v.user_id = $2 AND x.asset_id = $3
      ORDER BY v.created_at DESC LIMIT 10`, [actor.restaurantId, actor.userId, rawId.data.id]);
    return res.json({ reviews });
  });

  router.post('/visual/review', 'assistant.use', aiLimit, async (req, res) => {
    const parsed = visualReviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose one to three photos and confirm the privacy check.' });
    // Image evaluation remains disabled for live providers pending an approved privacy review.
    if (deps.ai?.name !== 'mock') return res.status(503).json({ error: 'Photo review is available in practice mode.' });
    if (!req.auth!.capabilities.includes('content.draft')) return res.status(403).json({ error: 'Photo access denied.' });
    const actor = req.auth!;
    const assets = await db.query<{ id: string; bytes: string }>(
      `SELECT id, encode(image_bytes, 'base64') AS bytes FROM visual_assets WHERE ${owner} AND id = ANY($3::uuid[])`,
      [actor.restaurantId, actor.userId, parsed.data.ids],
    );
    if (assets.length !== parsed.data.ids.length) return res.status(404).json({ error: 'One or more photos are unavailable.' });
    try {
      const provider = await guard(deps, actor, 'photo_review');
      const images = await Promise.all(parsed.data.ids.map(async (id) => ({
        mediaType: 'image/jpeg' as const,
        bytes: await sharp(Buffer.from(assets.find((asset) => asset.id === id)!.bytes, 'base64'))
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer(),
      })));
      const documents = await brandCoreDocuments(db, actor.restaurantId);
      const result = await callProvider(deps, actor, 'photo_review', provider, () => provider.structured({
        system: 'Assess the submitted photographs as visual evidence only. Separate visible observations, brand considerations, practical improvements and items to verify. Consider lighting, exposure, sharpness, composition, color, distractions, atmosphere, authenticity, platform and audience fit, and privacy. Never infer identities, ingredients, prices, names or availability.',
        prompt: 'Review the images in the selection order. If several are present, compare their suitability with reasons.',
        documents, images, schema: visualReviewResultSchema, effort: 'low',
        mock: () => ({
          observations: [`Practice request received ${images.length} validated image(s). This simulation makes no visual judgments.`],
          brandConsiderations: ['Compare the set with approved brand guidance before making a selection.'],
          recommendations: ['Compare exposure, texture and framing at the intended output size.'],
          verify: ['Check image rights, recognizable people and any factual claims before use.'],
          ...(images.length === 1 ? { suggestedRecipe: { exposure: 0.08, warmth: 0.1, contrast: 0, saturation: -0.04,
            highlights: 0, shadows: 0, sharpness: 0, crop: 'original' as const } } : {}),
        }),
      }));
      const validated = visualReviewResultSchema.safeParse(result.data);
      await recordUsage(db, { restaurantId: actor.restaurantId, userId: actor.userId, task: 'photo_review',
        provider: provider.name, model: result.model, usage: result.usage, outcome: result.refused ? 'refused' : validated.success ? 'ok' : 'error' });
      if (!validated.success || result.refused) return res.status(422).json({ error: 'The provider did not return a usable review.' });
      const reviewId = await db.transaction(async (tx) => {
        const [review] = await tx.query<{ id: string }>(`INSERT INTO visual_reviews (restaurant_id,user_id,result,simulated)
          VALUES ($1,$2,$3::jsonb,true) RETURNING id`, [actor.restaurantId, actor.userId, JSON.stringify(validated.data)]);
        await tx.query(`INSERT INTO visual_review_assets (review_id, restaurant_id, asset_id, position)
          SELECT $1, $2, x.id, (x.ordinality-1)::int FROM unnest($3::uuid[]) WITH ORDINALITY AS x(id, ordinality)`,
          [review!.id, actor.restaurantId, parsed.data.ids]);
        return review!.id;
      });
      return res.json({ reviewId, review: validated.data, simulated: true });
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      return res.status(503).json({ error: 'Practice photo review is unavailable or its budget limit was reached.' });
    }
  });
}
