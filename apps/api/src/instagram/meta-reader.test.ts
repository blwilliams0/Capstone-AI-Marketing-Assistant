import { expect, it, vi } from 'vitest';
import { createMetaMediaReader } from './meta-reader.js';
import { fetchPublishedMedia } from './practice.js';

it('reads only the configured account and follows validated cursors on the pinned Meta host', async () => {
  const date = '2026-11-01T20:00:00+0000';
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({
      data: [{ id: '123', media_type: 'IMAGE', timestamp: date }],
      paging: { next: 'https://untrusted.example/ignored', cursors: { after: 'second page' } },
    }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: '456', media_type: 'VIDEO', timestamp: date }] }));
  const reader = createMetaMediaReader({ accountId: '42', apiVersion: 'v27.0', token: 'test-only', fetcher });
  expect(await fetchPublishedMedia(reader)).toMatchObject([{ id: '123', kind: 'photo' }, { id: '456', kind: 'video' }]);
  const [url, options] = fetcher.mock.calls[1]!;
  expect(String(url)).toBe('https://graph.instagram.com/v27.0/42/media?fields=id%2Cmedia_type%2Ctimestamp&limit=24&after=second+page');
  expect(options).toMatchObject({ headers: { Authorization: 'Bearer test-only' }, redirect: 'error' });
  expect(String(url)).not.toContain('test-only');
  fetcher.mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 400 }));
  await expect(reader.page()).rejects.toMatchObject({ reason: 'expired' });
});
