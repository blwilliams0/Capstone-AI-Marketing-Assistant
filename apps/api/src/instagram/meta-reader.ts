import { z } from 'zod';
import type { PublishedMediaReader } from './practice.js';

const metaPageSchema = z.object({
  data: z.array(z.object({
    id: z.string().regex(/^\d{1,40}$/),
    media_type: z.enum(['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO']),
    timestamp: z.string().max(50),
  })).max(30),
  paging: z.object({
    next: z.string().optional(),
    cursors: z.object({ after: z.string().min(1).max(1000).optional() }).optional(),
  }).optional(),
});
const mediaKind = { IMAGE: 'photo', CAROUSEL_ALBUM: 'carousel', VIDEO: 'video' } as const;

export class InstagramReadError extends Error {
  constructor(readonly reason: 'expired' | 'rate_limited' | 'unavailable') {
    super('Instagram media could not be refreshed.');
  }
}

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new InstagramReadError('unavailable');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode()) as unknown;
      size += value.length;
      if (size > 128 * 1024) throw new InstagramReadError('unavailable');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel(); }
}

/** Reads one bounded page for a server-supplied professional account and token. */
export function createMetaMediaReader(input: {
  accountId: string; apiVersion: string; token: string; fetcher?: typeof fetch;
}): PublishedMediaReader {
  if (!/^\d{1,40}$/.test(input.accountId) || !/^v\d{1,3}\.\d{1,2}$/.test(input.apiVersion) || !input.token.trim()) {
    throw new Error('Invalid server-side Instagram reader configuration.');
  }
  const fetcher = input.fetcher ?? fetch;
  return {
    async page(cursor) {
      const url = new URL(`https://graph.instagram.com/${input.apiVersion}/${input.accountId}/media`);
      url.searchParams.set('fields', 'id,media_type,timestamp');
      url.searchParams.set('limit', '24');
      if (cursor) url.searchParams.set('after', cursor);
      try {
        const response = await fetcher(url, {
          headers: { Authorization: `Bearer ${input.token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 429) throw new InstagramReadError('rate_limited');
        if (response.status === 401 || response.status === 403) throw new InstagramReadError('expired');
        if (!response.ok) {
          const error = z.object({ error: z.object({ code: z.number() }) }).safeParse(await boundedJson(response));
          const code = error.success ? error.data.error.code : undefined;
          const rateCodes = [4, 17, 32, 613, 80002];
          throw new InstagramReadError(code === 190 ? 'expired' : code && rateCodes.includes(code) ? 'rate_limited' : 'unavailable');
        }
        const data = metaPageSchema.parse(await boundedJson(response));
        if (data.paging?.next && !data.paging.cursors?.after) throw new InstagramReadError('unavailable');
        return {
          items: data.data.map((item) => ({
            id: item.id, kind: mediaKind[item.media_type], title: 'Instagram ' + mediaKind[item.media_type],
            publishedAt: new Date(item.timestamp).toISOString(),
          })),
          next: data.paging?.next ? data.paging.cursors?.after : undefined,
        };
      } catch (error) {
        if (error instanceof InstagramReadError) throw error;
        throw new InstagramReadError('unavailable');
      }
    },
  };
}
