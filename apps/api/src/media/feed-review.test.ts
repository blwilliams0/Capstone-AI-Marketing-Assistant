import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createMockAiProvider, type StructuredRequest } from '../ai/provider.js';
import { createHarness } from '../testing/harness.js';

it('passes a normalized grid in display order and never calls the provider for inaccessible photos', async () => {
  const mock = createMockAiProvider();
  const calls: StructuredRequest<unknown>[] = [];
  const h = await createHarness({ ai: { ...mock, structured: async <T>(req: StructuredRequest<T>) => {
    calls.push(req as StructuredRequest<unknown>);
    return mock.structured(req);
  } } });
  try {
    const owner = await h.addUser('contributor');
    const peer = await h.addUser('admin');
    const outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Other') });
    const post = (token: string, path: string) => request(h.app).post(path).auth(token, { type: 'bearer' });
    const assets = await Promise.all(['red', 'blue'].map(async (background) => ({
      assetId: randomUUID(), bytes: await sharp({ create: { width: 14, height: 20, channels: 3, background } }).png().toBuffer(),
    })));
    for (const asset of assets) {
      expect((await post(owner.token, '/api/visual/assets').type('image/png').set('x-photo-id', asset.assetId)
        .set('x-photo-label', 'Fictional color fixture').send(asset.bytes)).status).toBe(201);
    }
    const endpoint = '/api/visual/feed-review';
    const photos = [
      { assetId: assets[1]!.assetId, existingFeed: true },
      { assetId: assets[0]!.assetId, existingFeed: false },
    ];
    for (const actor of [peer, outsider]) {
      expect((await post(actor.token, endpoint).send({ photos, privacyConfirmed: true })).status).toBe(404);
    }
    expect((await post(owner.token, endpoint).send({ photos: [photos[0], photos[0]], privacyConfirmed: true })).status).toBe(400);
    expect((await post(owner.token, endpoint).send({ photos, privacyConfirmed: false })).status).toBe(400);
    expect(calls).toHaveLength(0);
    const response = await post(owner.token, endpoint).send({ photos, privacyConfirmed: true });
    expect(response.status).toBe(200);
    expect(response.body.evaluation.photos).toEqual(photos);
    const history = (token: string) => request(h.app).get('/api/visual/feed-reviews').auth(token, { type: 'bearer' });
    expect((await history(owner.token)).body.evaluations[0].id).toBe(response.body.evaluation.id);
    expect((await history(peer.token)).body.evaluations).toEqual([]);
    const discuss = { question: 'What should I try next?', feedEvaluationId: response.body.evaluation.id };
    expect((await post(peer.token, '/api/assistant/ask').send(discuss)).status).toBe(404);
    const discussion = await post(owner.token, '/api/assistant/ask').send(discuss);
    expect(discussion.status).toBe(200);
    expect(await h.db.query('SELECT feed_evaluation_id FROM conversations WHERE id = $1', [discussion.body.conversationId]))
      .toEqual([{ feed_evaluation_id: response.body.evaluation.id }]);
    expect(response.body.simulated).toBe(true);
    expect(JSON.parse(calls[0]!.prompt).order).toEqual([{ position: 1, existingFeed: true }, { position: 2, existingFeed: false }]);
    for (const [index, image] of calls[0]!.images!.entries()) {
      const decoded = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info).toMatchObject({ width: 360, height: 360 });
      expect(decoded.data[index === 0 ? 2 : 0]).toBeGreaterThan(220);
    }
  } finally { await h.db.close(); }
});
