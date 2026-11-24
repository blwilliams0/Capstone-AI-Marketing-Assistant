import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const MEDIA_BUCKET = 'post-media';
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type MediaType = keyof typeof MEDIA_TYPES;

/**
 * Private photo storage. Server-side only (uses the secret key). Browsers never get general access:
 * they get a one-time upload link for one exact path, and short-lived links to view a photo after
 * the API has checked their permission.
 */
export interface MediaStore {
  /** Present only in the development-only local storage adapter. */
  storePracticePhoto?(path: string, bytes: Uint8Array): Promise<void>;
  createUploadLink(path: string): Promise<{ path: string; token: string }>;
  /** null when missing; 'too_large' (without reading it into memory) when over maxBytes. */
  download(path: string, maxBytes: number): Promise<Uint8Array | null | 'too_large'>;
  /** A short-lived link. With `download`, the browser saves the file instead of opening it. */
  viewLink(path: string, seconds: number, opts?: { download?: boolean }): Promise<string>;
  remove(path: string): Promise<void>;
}

export class MediaError extends Error {}

export function createSupabaseMediaStore(opts: { supabaseUrl: string; secretKey: string }): MediaStore {
  const client = createClient(opts.supabaseUrl, opts.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const bucket = () => client.storage.from(MEDIA_BUCKET);
  return {
    async createUploadLink(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data) throw new MediaError(error?.message ?? 'Could not create an upload link');
      return { path: data.path, token: data.token };
    },
    async download(path, maxBytes) {
      const { data, error } = await bucket().download(path);
      if (error || !data) {
        if (error) console.error(JSON.stringify({ level: 'warn', msg: 'media download failed', error: error.message }));
        return null;
      }
      if (data.size > maxBytes) return 'too_large';
      return new Uint8Array(await data.arrayBuffer());
    },
    async viewLink(path, seconds, o = {}) {
      const { data, error } = await bucket().createSignedUrl(path, seconds, o.download ? { download: true } : undefined);
      if (error || !data) throw new MediaError(error?.message ?? 'Could not create a view link');
      return data.signedUrl;
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) console.error(JSON.stringify({ level: 'warn', msg: 'media remove failed', error: error.message }));
    },
  };
}

/** Creates the private bucket if missing, and makes sure it is private. Idempotent. */
export async function ensureMediaBucket(opts: { supabaseUrl: string; secretKey: string }): Promise<'created' | 'already_private' | 'made_private'> {
  const client = createClient(opts.supabaseUrl, opts.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const settings = { public: false, fileSizeLimit: MEDIA_MAX_BYTES, allowedMimeTypes: Object.keys(MEDIA_TYPES) };
  const { data: existing } = await client.storage.getBucket(MEDIA_BUCKET);
  if (!existing) {
    const { error } = await client.storage.createBucket(MEDIA_BUCKET, settings);
    if (error) throw new MediaError(error.message);
    return 'created';
  }
  const { error } = await client.storage.updateBucket(MEDIA_BUCKET, settings);
  if (error) throw new MediaError(error.message);
  return existing.public ? 'made_private' : 'already_private';
}

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export type PhotoCheck = 'ok' | 'no_photo' | 'storage_off' | 'changed';

/**
 * Re-checks that the stored photo of a post version still has the fingerprint that was recorded
 * (and approved). Used before approving and before recording a post, so a file changed or removed
 * in storage can never go out under an approval it does not match.
 */
export async function checkStoredPhoto(media: MediaStore | undefined, path: string | null, sha256: string | null): Promise<PhotoCheck> {
  if (!path || !sha256) return 'no_photo';
  if (!media) return 'storage_off';
  const bytes = await media.download(path, MEDIA_MAX_BYTES);
  if (!bytes || bytes === 'too_large') return 'changed';
  return sha256Hex(bytes) === sha256 ? 'ok' : 'changed';
}

/** Detects the real image type from the first bytes (never trusts the file name or browser). */
export function sniffImageType(bytes: Uint8Array): MediaType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
