import type { Db } from '@the-pocket/db';
import { collectionInputSchema, collectionKindSchema, type VisualCollection } from '@the-pocket/shared';
import { z } from 'zod';
import type { PolicyRouter } from '../policy.js';
import { recordAudit } from '../audit.js';

// Only albums grant image access. A feed references assets without expanding their audience.
export const albumGrant = `EXISTS (SELECT 1 FROM visual_collection_items ci
  JOIN visual_collections c ON c.id = ci.collection_id AND c.restaurant_id = ci.restaurant_id
  WHERE ci.asset_id = a.id AND ci.restaurant_id = a.restaurant_id AND c.kind = 'album'
    AND c.owner_id = a.owner_id AND (c.visibility = 'team' OR (c.visibility = 'management' AND $3::boolean)))`;
export const visibleAsset = `a.restaurant_id = $1 AND (a.owner_id = $2 OR ${albumGrant})`;

export function addCollectionRoutes(router: PolicyRouter, db: Db) {
  router.get('/visual/collections', 'content.draft', async (req, res) => {
    const kind = collectionKindSchema.safeParse(req.query.kind);
    if (!kind.success) return res.status(400).json({ error: 'Choose an album or feed collection.' });
    const actor = req.auth!;
    const values = [actor.restaurantId, actor.userId, actor.role === 'admin', kind.data];
    const collections = await db.query<VisualCollection>(`
      SELECT c.id, c.kind, c.name, c.visibility, c.revision, c.owner_id = $2 AS editable,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('assetId', a.id, 'existingFeed', i.existing_feed) ORDER BY i.position)
          FROM visual_collection_items i JOIN visual_assets a ON a.id = i.asset_id
          WHERE i.collection_id = c.id AND ${visibleAsset}), '[]'::jsonb) AS items
      FROM visual_collections c
      WHERE c.restaurant_id = $1 AND c.kind = $4
        AND (c.owner_id = $2 OR c.visibility = 'team' OR (c.visibility = 'management' AND $3::boolean))
      ORDER BY c.name, c.id`, values);
    return res.json({ collections });
  });

  router.post('/visual/collections', 'content.draft', async (req, res) => {
    const parsed = collectionInputSchema.safeParse(req.body);
    const id = z.uuid().optional().safeParse(req.query.id);
    if (!parsed.success || !id.success || Boolean(id.data) !== Boolean(parsed.data.revision)) {
      return res.status(400).json({ error: 'Invalid collection or revision.' });
    }
    const actor = req.auth!;
    const { kind, name, visibility, revision, items } = parsed.data;
    const admin = actor.role === 'admin';
    if (visibility === 'management' && !admin) return res.status(403).json({ error: 'Management access is restricted.' });
    const result = await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM restaurants WHERE id = $1 FOR UPDATE', [actor.restaurantId]);
      if (id.data) {
        const [prior] = await tx.query<{ revision: number }>(
          'SELECT revision FROM visual_collections WHERE restaurant_id = $1 AND owner_id = $2 AND id = $3 AND kind = $4',
          [actor.restaurantId, actor.userId, id.data, kind],
        );
        if (!prior) return 'missing';
        if (prior.revision !== revision) return 'conflict';
      }
      const canInclude = kind === 'album' && visibility !== 'private'
        ? 'a.restaurant_id = $1 AND a.owner_id = $2 AND $3::boolean IS NOT NULL'
        : kind === 'feed' && visibility !== 'private'
          ? `a.restaurant_id = $1 AND $2::uuid IS NOT NULL AND ${albumGrant}`
          : visibleAsset;
      const allowed = await tx.query(
        `SELECT a.id FROM visual_assets a WHERE ${canInclude} AND a.id = ANY($4::uuid[])`,
        [actor.restaurantId, actor.userId, visibility === 'management' || (visibility === 'private' && admin), items.map((item) => item.assetId)],
      );
      if (allowed.length !== items.length) return 'assets';
      const [saved] = id.data
        ? await tx.query<{ id: string; revision: number }>(
          'UPDATE visual_collections SET name = $1, visibility = $2, revision = revision + 1 WHERE id = $3 RETURNING id, revision',
          [name, visibility, id.data])
        : await tx.query<{ id: string; revision: number }>(
          'INSERT INTO visual_collections (restaurant_id, owner_id, kind, name, visibility) VALUES ($1,$2,$3,$4,$5) RETURNING id, revision',
          [actor.restaurantId, actor.userId, kind, name, visibility]);
      if (!saved) throw new Error('Collection write returned no row.');
      await tx.query('DELETE FROM visual_collection_items WHERE collection_id = $1', [saved.id]);
      if (items.length) {
        await tx.query(`INSERT INTO visual_collection_items (collection_id, restaurant_id, asset_id, position, existing_feed)
          SELECT $1, $2, item.asset_id, (item.ordinality - 1)::int, item.existing_feed
          FROM unnest($3::uuid[], $4::boolean[]) WITH ORDINALITY AS item(asset_id, existing_feed, ordinality)`,
        [saved.id, actor.restaurantId, items.map((item) => item.assetId), items.map((item) => item.existingFeed)]);
      }
      await recordAudit(tx, { action: 'visual.collection_saved', restaurantId: actor.restaurantId,
        actorUserId: actor.userId, targetType: kind, targetId: saved.id,
        requestId: req.requestId, details: { revision: saved.revision, visibility, itemCount: items.length } });
      return { ...saved, kind, visibility, name, items, editable: true };
    });
    if (result === 'missing') return res.status(404).json({ error: 'Collection unavailable.' });
    if (result === 'conflict') return res.status(409).json({ error: 'This collection changed. Reload it before saving again.' });
    if (result === 'assets') return res.status(400).json({ error: 'One or more photos are unavailable for this audience. Share your own photos through an album first.' });
    return res.status(id.data ? 200 : 201).json(result);
  });
}
