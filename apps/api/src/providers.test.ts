import { describe, it, expect } from 'vitest';
import { createMockSocialPublisher } from './providers/social.js';
import { redact } from './audit.js';

const digest = 'a'.repeat(64);

describe('mock social publisher', () => {
  it('requires an approval digest and media checksum', async () => {
    const p = createMockSocialPublisher();
    await expect(
      // @ts-expect-error deliberately missing approvalDigest
      p.publish({ platform: 'instagram', accountExternalId: 'a', caption: 'c', mediaChecksum: digest }),
    ).rejects.toThrow();
    await expect(
      p.publish({ platform: 'instagram', accountExternalId: 'a', caption: 'c', mediaChecksum: 'bad', approvalDigest: digest }),
    ).rejects.toThrow();
  });

  it('returns a mock result and never contacts a real account', async () => {
    const res = await createMockSocialPublisher().publish({
      platform: 'instagram',
      accountExternalId: 'acct',
      caption: 'Hello',
      mediaChecksum: digest,
      approvalDigest: digest,
    });
    expect(res).toMatchObject({ status: 'published', mock: true });
    expect(res.externalPostId).toMatch(/^mock-post-/);
  });
});

describe('audit redaction', () => {
  it('redacts secrets at any depth and keeps ordinary fields', () => {
    const out = redact({
      email: 'a@example.test',
      access_token: 'abc',
      nested: { Password: 'x', api_key: 'y', list: [{ authorization: 'Bearer z', ok: 1 }] },
    });
    expect(out).toEqual({
      email: 'a@example.test',
      access_token: '[redacted]',
      nested: { Password: '[redacted]', api_key: '[redacted]', list: [{ authorization: '[redacted]', ok: 1 }] },
    });
  });
});
