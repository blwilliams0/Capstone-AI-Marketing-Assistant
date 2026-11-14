import { z } from 'zod';

/**
 * Social publishing abstraction. Stage 1 ships only a mock. It is deliberately NOT exposed over
 * HTTP and not wired into the app: publishing will only ever be called by the worker, after a
 * valid approval is re-checked (Architecture section 7, Stage 4). No real accounts are contacted.
 */
export const publishRequestSchema = z.object({
  platform: z.enum(['instagram', 'facebook']),
  accountExternalId: z.string().min(1),
  caption: z.string().min(1).max(2200),
  mediaChecksum: z.string().regex(/^[a-f0-9]{64}$/, 'SHA-256 hex digest required'),
  approvalDigest: z.string().regex(/^[a-f0-9]{64}$/, 'SHA-256 hex digest required'),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export interface PublishResult {
  externalPostId: string;
  status: 'published';
  mock: boolean;
}

export interface SocialPublisher {
  publish(request: PublishRequest): Promise<PublishResult>;
}

export function createMockSocialPublisher(): SocialPublisher {
  let counter = 0;
  return {
    async publish(request) {
      publishRequestSchema.parse(request); // rejects malformed requests; caption is never logged
      counter += 1;
      return { externalPostId: `mock-post-${counter}`, status: 'published', mock: true };
    },
  };
}
