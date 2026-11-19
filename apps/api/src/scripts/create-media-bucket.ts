import { createClient } from '@supabase/supabase-js';
import { ensureMediaBucket, MEDIA_BUCKET } from '../media/store.js';

/**
 * Creates (or re-checks) the PRIVATE photo bucket in Supabase Storage. Safe to run again.
 *   npm run create-media-bucket -w @the-pocket/api
 * Prints only the outcome and the bucket settings; never keys.
 */
const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey) {
  console.error('Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.');
  process.exit(1);
}
const outcome = await ensureMediaBucket({ supabaseUrl, secretKey });
const client = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data } = await client.storage.getBucket(MEDIA_BUCKET);
console.log(
  JSON.stringify({ outcome, bucket: MEDIA_BUCKET, public: data?.public, fileSizeLimit: data?.file_size_limit, allowedMimeTypes: data?.allowed_mime_types }),
);
