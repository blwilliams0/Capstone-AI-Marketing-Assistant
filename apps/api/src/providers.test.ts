import { describe, it, expect } from 'vitest';
import { createMockAiProvider, modelFor } from './providers/ai.js';
import { createMockSocialPublisher } from './providers/social.js';
import { redact } from './audit.js';

const digest = 'a'.repeat(64);

describe('mock AI provider', () => {
  it('routes interviews and evidence synthesis to Plus, routine tasks to Flash', () => {
    expect(modelFor('brand_interview')).toBe('qwen3.7-plus');
    expect(modelFor('brand_rule_extract')).toBe('qwen3.7-plus');
    expect(modelFor('content_draft')).toBe('qwen3.8-flash');
    expect(modelFor('marketing_question')).toBe('qwen3.8-flash');
  });

  it('always returns a clearly labelled draft', async () => {
    const res = await createMockAiProvider().generate({ task: 'content_draft', prompt: 'hello' });
    expect(res.status).toBe('draft');
    expect(res.mock).toBe(true);
    expect(res.text).toMatch(/MOCK/);
  });

  it('rejects invalid requests instead of crashing on missing fields', async () => {
    const p = createMockAiProvider();
    // @ts-expect-error deliberately invalid
    await expect(p.generate({ task: 'publish_everything', prompt: 'x' })).rejects.toThrow();
    // @ts-expect-error deliberately invalid
    await expect(p.generate({})).rejects.toThrow();
  });
});

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
