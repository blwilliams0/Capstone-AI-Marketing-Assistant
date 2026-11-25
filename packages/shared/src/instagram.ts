import { z } from 'zod';

export const practiceInstagramActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['connect', 'disconnect']) }),
  z.object({ action: z.literal('sync'), scenario: z.enum(['normal', 'changed', 'expired', 'rate_limited', 'unavailable']).default('normal') }),
]);

export const instagramMediaSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['photo', 'carousel', 'reel', 'video']),
  title: z.string().min(1).max(100),
  publishedAt: z.iso.datetime(),
});
export type InstagramMedia = z.infer<typeof instagramMediaSchema>;
export interface PracticeInstagramConnection {
  state: 'connected' | 'disconnected' | 'expired';
  lastSyncedAt: string | null;
  lastError: 'expired' | 'rate_limited' | 'unavailable' | null;
  media: InstagramMedia[];
}
