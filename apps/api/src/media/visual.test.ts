import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createMockAiProvider, type StructuredRequest } from '../ai/provider.js';
import { createHarness } from '../testing/harness.js';

it('finalizes private photos idempotently, preserves edits and supplies actual normalized image bytes to review', async () => {
  const mock = createMockAiProvider();
  const reviewed: Uint8Array[] = [];
  const h = await createHarness({ ai: { ...mock, async structured<T>(input: StructuredRequest<T>) {
    reviewed.push(...(input.images ?? []).map(({ bytes }) => bytes));
    return mock.structured(input);
  } } });
  try {
    const member = await h.addUser('contributor');
    const colleague = await h.addUser('contributor');
    const outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Other') });
    const viewer = await h.addUser('viewer');
    const photo = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'olive' } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const id = randomUUID();
    const upload = (assetId: string, label: string, token: string, parent?: string) => {
      const req = request(h.app).post('/api/visual/assets').auth(token, { type: 'bearer' })
        .type('image/jpeg').set('x-photo-id', assetId).set('x-photo-label', label);
      if (parent) req.set('x-photo-parent', parent).set('x-photo-edits', JSON.stringify({
        exposure: 0.1, warmth: 0, contrast: 0, saturation: 0, highlights: 0, shadows: 0, sharpness: 0, crop: 'original',
      }));
      return req.send(photo);
    };
    expect((await upload(id, 'Source', viewer.token)).status).toBe(403);
    expect((await upload(id, 'Source', member.token)).status).toBe(201);
    expect((await upload(id, 'Source', member.token)).status).toBe(200);
    expect((await upload(id, 'Other label', member.token)).status).toBe(409);
    expect((await upload(randomUUID(), 'Unauthorized edit', colleague.token, id)).status).toBe(404);
    const copy = await upload(randomUUID(), 'Edited copy', member.token, id);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ parentId: id, edits: { exposure: 0.1 } });
    const image = `/api/visual/assets/${id}/image`;
    const get = (token: string) => request(h.app).get(image).auth(token, { type: 'bearer' });
    expect((await get(outsider.token)).status).toBe(404);
    expect((await get(colleague.token)).status).toBe(404);
    const owned = await get(member.token);
    expect(owned.headers['cache-control']).toBe('private, no-store');
    expect(await sharp(owned.body).metadata()).toMatchObject({ width: 10, height: 20, format: 'jpeg' });
    expect((await sharp(owned.body).metadata()).exif).toBeUndefined();
    const review = await request(h.app).post('/api/visual/review').auth(member.token, { type: 'bearer' })
      .send({ ids: [id, copy.body.id], privacyConfirmed: true });
    expect(review.status).toBe(200);
    expect(review.body.simulated).toBe(true);
    expect(reviewed).toHaveLength(2);
    expect(await sharp(reviewed[0]!).metadata()).toMatchObject({ width: 10, height: 20, format: 'jpeg' });
    const [usage] = await h.db.query<{ task: string; provider: string; outcome: string }>(
      'SELECT task, provider, outcome FROM ai_usage_events WHERE user_id = $1', [member.userId],
    );
    expect(usage).toEqual({ task: 'photo_review', provider: 'mock', outcome: 'ok' });
  } finally { await h.db.close(); }
});
