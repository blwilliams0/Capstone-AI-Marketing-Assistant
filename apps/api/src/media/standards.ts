import { z } from 'zod';
import { recordAudit } from '../audit.js';
import type { Db } from '@the-pocket/db';
import { visualStandardInputSchema, type VisualStandard } from '@the-pocket/shared';
import { createItemTx, proposeVersionTx } from '../knowledge/service.js';
import type { AuthContext } from '../types.js';
import type { PolicyRouter } from '../policy.js';
import { albumGrant, visibleAsset } from './collections.js';

export function addVisualStandardRoutes(router: PolicyRouter, db: Db) {
  router.get('/visual/standards', 'content.draft', async (req, res) => {
    const actor = req.auth!;
    const standards = await db.query<VisualStandard>(`SELECT
      i.id AS "itemId", v.id AS "versionId", i.title, v.body AS rationale, v.version, v.status,
      s.kind, s.asset_id AS "assetId", s.classification, s.category, s.recipe,
      COALESCE(p.allowed, false) AS "liveImageAllowed"
      FROM visual_standards s JOIN knowledge_versions v ON v.id = s.version_id
      JOIN knowledge_items i ON i.id = v.item_id
      LEFT JOIN visual_assets a ON a.id = s.asset_id
      LEFT JOIN reference_image_permissions p ON p.version_id = v.id
      WHERE s.restaurant_id = $1 AND i.retired_at IS NULL
      AND (v.expires_at IS NULL OR v.expires_at > now())
      AND (v.status = 'approved' OR v.proposed_by = $2 OR $3::boolean)
      AND (s.asset_id IS NULL OR (${visibleAsset}))
      ORDER BY i.title, v.version DESC`, [actor.restaurantId, actor.userId, actor.role === 'admin']);
    return res.json({ standards });
  });

  router.post('/visual/standards/:id/image-permission', 'knowledge.propose', async (req, res) => {
    const input = z.object({ id: z.uuid(), allowed: z.boolean() }).safeParse({ id: req.params.id, allowed: req.body?.allowed });
    if (!input.success) return res.status(400).json({ error: 'Choose a reference version and confirm the permission.' });
    const actor = req.auth!;
    const permitted = await db.transaction(async (tx) => {
      const [owner] = await tx.query(`SELECT v.id FROM visual_standards s JOIN knowledge_versions v ON v.id = s.version_id
        JOIN knowledge_items i ON i.id = v.item_id JOIN visual_assets a ON a.id = s.asset_id
        WHERE s.restaurant_id = $1 AND a.owner_id = $2 AND s.version_id = $3
          AND ($4::boolean = false OR (v.status = 'approved' AND i.retired_at IS NULL
            AND (v.expires_at IS NULL OR v.expires_at > now()) AND s.classification = 'on_brand'))`,
      [actor.restaurantId, actor.userId, input.data.id, input.data.allowed]);
      if (!owner) return false;
      await tx.query(`INSERT INTO reference_image_permissions (version_id, allowed) VALUES ($1, $2)
        ON CONFLICT (version_id) DO UPDATE SET allowed = EXCLUDED.allowed, changed_at = now()`, [input.data.id, input.data.allowed]);
      await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId, action: 'visual.reference_image_permission',
        targetType: 'knowledge_version', targetId: input.data.id, details: { allowed: input.data.allowed }, requestId: req.requestId });
      return true;
    });
    if (!permitted) return res.status(404).json({ error: 'An eligible reference version owned by you is required.' });
    return res.json({ allowed: input.data.allowed });
  });

  router.post('/visual/standards', 'knowledge.propose', async (req, res) => {
    const checked = visualStandardInputSchema.safeParse(req.body);
    if (!checked.success) return res.status(400).json({ error: 'Enter valid visual standard details.' });
    const actor = req.auth!;
    const value = checked.data;
    if (value.kind === 'preset' && actor.role !== 'admin') return res.status(403).json({ error: 'Only management can propose presets.' });
    const result = await db.transaction(async (tx) => {
      // Serialize with album access changes while accepting a reference.
      await tx.query('SELECT id FROM restaurants WHERE id = $1 FOR UPDATE', [actor.restaurantId]);
      if (value.kind === 'reference') {
        const [shared] = await tx.query(`SELECT a.id FROM visual_assets a WHERE a.restaurant_id = $1
          AND a.owner_id = $2 AND ${albumGrant} AND a.id = $4`, [actor.restaurantId, actor.userId, false, value.assetId]);
        if (!shared) return null;
      }
      let saved: { itemId: string; versionId: string };
      if (value.itemId) {
        const [existing] = await tx.query(`SELECT i.id FROM knowledge_items i WHERE i.id = $1 AND i.restaurant_id = $2
          AND i.title = $3 AND EXISTS (SELECT 1 FROM knowledge_versions v JOIN visual_standards s ON s.version_id = v.id
          WHERE v.item_id = i.id AND s.kind = $4)`, [value.itemId, actor.restaurantId, value.title, value.kind]);
        if (!existing) return null;
        const version = await proposeVersionTx(tx, actor, value.itemId, { body: value.rationale }, req.requestId, true);
        if (typeof version === 'string') return null;
        saved = { itemId: value.itemId, versionId: version.versionId };
      } else {
        saved = await createItemTx(tx, actor, { kind: 'reference', title: value.title, body: value.rationale }, req.requestId);
      }
      await tx.query(`INSERT INTO visual_standards (version_id, restaurant_id, kind, asset_id, classification, category, recipe)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [
        saved.versionId, actor.restaurantId, value.kind, value.kind === 'reference' ? value.assetId : null,
        value.kind === 'reference' ? value.classification : null, value.category, value.kind === 'preset' ? JSON.stringify(value.recipe) : null,
      ]);
      return saved;
    });
    if (!result) return res.status(404).json({ error: 'Standard or photo unavailable. References must use a photo you explicitly shared with the restaurant team.' });
    return res.status(201).json(result);
  });
}

/** Bounded approved visual context. Reference access is rechecked when the context is built. */
export async function approvedVisualContext(db: Db, actor: AuthContext) {
  return db.query<Pick<VisualStandard, 'title' | 'rationale' | 'versionId' | 'kind' | 'classification' | 'recipe'>>(`
    SELECT i.title, left(v.body, 700) AS rationale, v.id AS "versionId", s.kind, s.classification, s.recipe
    FROM visual_standards s JOIN knowledge_versions v ON v.id = s.version_id
    JOIN knowledge_items i ON i.id = v.item_id LEFT JOIN visual_assets a ON a.id = s.asset_id
    WHERE s.restaurant_id = $1 AND i.retired_at IS NULL AND v.status = 'approved'
      AND (v.expires_at IS NULL OR v.expires_at > now()) AND (s.asset_id IS NULL OR (${visibleAsset} AND ${albumGrant}))
    ORDER BY CASE WHEN s.kind = 'preset' THEN 0 ELSE 1 END, v.decided_at DESC, v.id LIMIT 8`,
  [actor.restaurantId, actor.userId, false]);
}

/** Images are restricted to current, on-brand standards still shared with the team. */
export async function approvedReferenceImages(db: Db, actor: AuthContext, assetId: string, request: string, requireConsent = false) {
  return db.query<{ versionId: string; bytes: string }>(`SELECT v.id AS "versionId", encode(a.image_bytes, 'base64') AS bytes
    FROM visual_standards s JOIN knowledge_versions v ON v.id = s.version_id
    JOIN knowledge_items i ON i.id = v.item_id JOIN visual_assets a ON a.id = s.asset_id
    WHERE s.restaurant_id = $1 AND i.retired_at IS NULL AND v.status = 'approved'
      AND (NOT $6::boolean OR EXISTS (
        SELECT 1 FROM reference_image_permissions p WHERE p.version_id = v.id AND p.allowed
      ))
      AND s.kind = 'reference' AND s.classification = 'on_brand' AND a.id <> $4
      AND (v.expires_at IS NULL OR v.expires_at > now()) AND ${visibleAsset} AND ${albumGrant}
    ORDER BY ts_rank(to_tsvector('english', i.title || ' ' || s.category || ' ' || v.body), plainto_tsquery('english', $5)) DESC,
      v.decided_at DESC, v.id LIMIT 2`,
  [actor.restaurantId, actor.userId, false, assetId, request, requireConsent]);
}
