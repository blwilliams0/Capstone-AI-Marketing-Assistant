import type { Db } from '@the-pocket/db';
import { collectionInputSchema, collectionKindSchema, type VisualCollection } from '@the-pocket/shared';
import { z } from 'zod';
import type { PolicyRouter } from '../policy.js';
import { recordAudit } from '../audit.js';

// Only albums grant image access. A feed references assets without expanding their audience.
export const albumGrant = `EXISTS (SELECT 1 FROM visual_collection_items ci
  JOIN visual_collections c ON c.id = ci.collection_id AND c.restaurant_id = ci.restaurant_id
  WHERE ci.asset_id = a.id AND ci.restaurant_id = a.restaurant_id AND c.kind = 'album'
    AND c.archived_at IS NULL AND c.owner_id = a.owner_id AND (c.visibility = 'team' OR (c.visibility = 'management' AND $3::boolean)))`;
export const visibleAsset = `a.restaurant_id = $1 AND (a.owner_id = $2 OR ${albumGrant})`;

export function addCollectionRoutes(router: PolicyRouter, db: Db) {
  router.get('/visual/collections', 'content.draft', async (req, res) => {
    const kind = collectionKindSchema.safeParse(req.query.kind);
    if (!kind.success) return res.status(400).json({ error: 'Choose an album or feed collection.' });
    const actor = req.auth!;
    const values = [actor.restaurantId, actor.userId, actor.role === 'admin', kind.data];
    const collections = await db.query<VisualCollection>(`
      SELECT c.id, c.kind, c.name, c.visibility, c.revision, COALESCE(c.owner_id = $2, $3::boolean) AS editable, c.default_key IS NOT NULL AS "restaurantDefault",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('assetId', a.id, 'existingFeed', i.existing_feed) ORDER BY i.position)
          FROM visual_collection_items i JOIN visual_assets a ON a.id = i.asset_id
          WHERE i.collection_id = c.id AND ${visibleAsset}), '[]'::jsonb) AS items
      FROM visual_collections c
      WHERE c.restaurant_id = $1 AND c.kind = $4 AND c.archived_at IS NULL
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
      let restaurantDefault = false;
      if (id.data) {
        const [prior] = await tx.query<{ revision: number; restaurantDefault: boolean }>(
           'SELECT revision, default_key IS NOT NULL AS "restaurantDefault" FROM visual_collections WHERE restaurant_id = $1 AND id = $3 AND kind = $4 AND archived_at IS NULL AND (owner_id = $2 OR (owner_id IS NULL AND $5::boolean))',
          [actor.restaurantId, actor.userId, id.data, kind, admin],
        );
        if (!prior) return 'missing';
        if (prior.revision !== revision) return 'conflict';
        restaurantDefault = prior.restaurantDefault;
        if (restaurantDefault && visibility === 'private') return 'default-private';
      }
      const canInclude = restaurantDefault
        ? `a.restaurant_id = $1 AND $2::uuid IS NOT NULL AND ${albumGrant}`
        : kind === 'album' && visibility !== 'private'
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
      return { ...saved, kind, visibility, name, items, editable: true, restaurantDefault };
    });
    if (result === 'missing') return res.status(404).json({ error: 'Collection unavailable.' });
    if (result === 'conflict') return res.status(409).json({ error: 'This collection changed. Reload it before saving again.' });
    if (result === 'default-private') return res.status(400).json({ error: 'Restaurant albums can be shared with the team or restricted to management.' });
    if (result === 'assets') return res.status(400).json({ error: 'One or more photos are unavailable for this audience. Share your own photos through an album first.' });
    return res.status(id.data ? 200 : 201).json(result);
  });

  router.post('/visual/collections/:id/archive', 'brand.approve', async (req, res) => {
    const input = z.object({ id: z.uuid(), revision: z.number().int().positive() }).safeParse({
      id: req.params.id, revision: req.body?.revision,
    });
    if (!input.success) return res.status(400).json({ error: 'Invalid album or revision.' });
    const actor = req.auth!;
    const result = await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM restaurants WHERE id = $1 FOR UPDATE', [actor.restaurantId]);
      const [album] = await tx.query<{ revision: number }>(`SELECT revision FROM visual_collections
        WHERE id = $1 AND restaurant_id = $2 AND kind = 'album' AND archived_at IS NULL
          AND (visibility <> 'private' OR owner_id = $3)`, [input.data.id, actor.restaurantId, actor.userId]);
      if (!album) return 'missing';
      if (album.revision !== input.data.revision) return 'conflict';
      await tx.query('UPDATE visual_collections SET archived_at = now(), revision = revision + 1 WHERE id = $1', [input.data.id]);
      await recordAudit(tx, { action: 'visual.collection_archived', restaurantId: actor.restaurantId,
        actorUserId: actor.userId, targetType: 'album', targetId: input.data.id, requestId: req.requestId });
      return 'archived';
    });
    if (result === 'missing') return res.status(404).json({ error: 'Album unavailable.' });
    if (result === 'conflict') return res.status(409).json({ error: 'This album changed. Reload it before archiving.' });
    return res.json({ archived: true });
  });

}
