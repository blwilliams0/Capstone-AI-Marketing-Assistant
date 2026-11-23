import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import { editPost } from '../content/service.js';
import { badRequest } from '../knowledge/routes.js';
import type { PolicyRouter } from '../policy.js';
import { MEDIA_BUCKET, MEDIA_MAX_BYTES, MEDIA_TYPES, sha256Hex, sniffImageType, type MediaStore, type MediaType } from './store.js';
import { rateLimit } from '../middleware.js';

const itemParam = z.object({ itemId: z.string().uuid() });
const uploadLinkSchema = z.object({ contentType: z.enum(Object.keys(MEDIA_TYPES) as [MediaType, ...MediaType[]]) });
const attachSchema = z.object({ path: z.string().max(300) });
const viewQuery = z.object({ versionId: z.string().uuid(), download: z.enum(['0', '1']).optional() });

const VIEW_SECONDS = 300;
const fail = (res: Response, status: number, error: string, reason: string) => res.status(status).json({ error, reason });

/** An editable post of this restaurant (exists, not archived, not yet posted). */
async function editable(db: Db, restaurantId: string, itemId: string): Promise<'ok' | 'not_found' | 'locked'> {
  const [row] = await db.query<{ archived: boolean; posted: boolean }>(
    `SELECT (i.archived_at IS NOT NULL) AS archived, EXISTS (SELECT 1 FROM post_records r WHERE r.item_id = i.id) AS posted
       FROM content_items i WHERE i.id = $1 AND i.restaurant_id = $2`,
    [itemId, restaurantId],
  );
  if (!row) return 'not_found';
  return row.archived || row.posted ? 'locked' : 'ok';
}

export function addMediaRoutes(r: PolicyRouter, db: Db, media: MediaStore | undefined) {
  // Uploads use storage: at most 60 upload requests (links plus attaches) per person per 10 minutes.
  const uploadLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60 });
  const unavailable = (res: Response) => fail(res, 503, 'Photo storage is not set up. The server needs its Supabase secret key.', 'media_disabled');

  // 1. A one-time upload link for one new, server-chosen path.
  r.post('/posts/:itemId/media/upload-link', 'content.draft', uploadLimit, async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = uploadLinkSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    if (!media) return unavailable(res);
    const a = req.auth!;
    const state = await editable(db, a.restaurantId, p.data.itemId);
    if (state === 'not_found') return fail(res, 404, 'Post not found.', state);
    if (state === 'locked') return fail(res, 409, 'This post is archived or already posted.', state);
    const path = `${a.restaurantId}/${p.data.itemId}/${randomUUID()}.${MEDIA_TYPES[b.data.contentType]}`;
    const link = await media.createUploadLink(path);
    res.status(201).json({ bucket: MEDIA_BUCKET, path: link.path, token: link.token, maxBytes: MEDIA_MAX_BYTES });
  });

  // 2. After uploading: the server checks the file itself, fingerprints it and saves a new version.
  r.post('/posts/:itemId/media', 'content.draft', uploadLimit, async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = attachSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    if (!media) return unavailable(res);
    const a = req.auth!;
    const m = new RegExp(`^${a.restaurantId}/${p.data.itemId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).exec(b.data.path);
    if (!m) return fail(res, 400, 'That upload does not belong to this post.', 'bad_path');
    const state = await editable(db, a.restaurantId, p.data.itemId);
    if (state === 'not_found') return fail(res, 404, 'Post not found.', state);
    if (state === 'locked') return fail(res, 409, 'This post is archived or already posted.', state);

    const bytes = await media.download(b.data.path, MEDIA_MAX_BYTES);
    if (!bytes) return fail(res, 404, 'The photo has not finished uploading. Try again.', 'not_uploaded');
    // Rejected files are deleted at once, so storage only keeps photos that were attached.
    if (bytes === 'too_large' || bytes.length > MEDIA_MAX_BYTES) {
      await media.remove(b.data.path);
      return fail(res, 413, 'Photos must be 10 MB or smaller.', 'too_large');
    }
    const type = sniffImageType(bytes);
    if (!type || MEDIA_TYPES[type] !== m[1]) {
      await media.remove(b.data.path);
      return fail(res, 400, 'That file is not a JPEG, PNG or WebP photo.', 'not_an_image');
    }

    const sha256 = sha256Hex(bytes);
    const out = await editPost(db, a, p.data.itemId, { media: { path: b.data.path, sha256 } }, req.requestId);
    if (typeof out === 'string') return fail(res, out === 'not_found' ? 404 : 409, 'This post can no longer be changed.', out);
    res.status(201).json({ ...out, sha256 });
  });

  r.post('/posts/:itemId/media/remove', 'content.draft', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    // Nothing to remove: don't create a version (it would cancel an approval for no reason).
    const [latest] = await db.query<{ media_path: string | null }>(
      `SELECT media_path FROM content_versions WHERE item_id = $1 AND restaurant_id = $2 ORDER BY version DESC LIMIT 1`,
      [p.data.itemId, req.auth!.restaurantId],
    );
    if (!latest) return fail(res, 404, 'Post not found.', 'not_found');
    if (!latest.media_path) return fail(res, 409, 'This post has no photo.', 'no_photo');
    // The file itself is kept: earlier versions (and their approval history) still refer to it.
    const out = await editPost(db, req.auth!, p.data.itemId, { media: null }, req.requestId);
    if (typeof out === 'string') return fail(res, out === 'not_found' ? 404 : 409, 'This post can no longer be changed.', out);
    res.status(201).json(out);
  });

  // 3. A short-lived link to view or download one version's photo, after the permission check.
  r.get('/posts/:itemId/media', 'content.view', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const q = viewQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    if (!media) return unavailable(res);
    const [v] = await db.query<{ media_path: string | null }>(
      `SELECT media_path FROM content_versions WHERE id = $1 AND item_id = $2 AND restaurant_id = $3`,
      [q.data.versionId, p.data.itemId, req.auth!.restaurantId],
    );
    if (!v?.media_path) return fail(res, 404, 'No photo for that version.', 'not_found');
    res.json({ url: await media.viewLink(v.media_path, VIEW_SECONDS, { download: q.data.download === '1' }), expiresInSeconds: VIEW_SECONDS });
  });
}
