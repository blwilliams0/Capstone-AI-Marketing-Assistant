import request from 'supertest';
import { expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

it('synchronizes fictional pages and preserves the last complete batch through failures', async () => {
  const h = await createHarness({ practiceInstagram: true });
  try {
    const owner = await h.addUser('admin');
    const colleague = await h.addUser('contributor');
    const outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Fixture tenant') });
    const path = '/api/instagram/practice';
    const get = (token: string) => request(h.app).get(path).auth(token, { type: 'bearer' });
    const action = (token: string, action: string, scenario?: string) => request(h.app).post(path).auth(token, { type: 'bearer' }).send({ action, scenario });
    expect((await get(owner.token)).body.state).toBe('disconnected');
    expect((await action(colleague.token, 'connect')).status).toBe(403);
    expect((await action(owner.token, 'sync')).status).toBe(409);
    expect((await action(owner.token, 'connect')).body.state).toBe('connected');
    const refreshed = (await action(owner.token, 'sync')).body;
    expect(refreshed.media.map((item: { kind: string }) => item.kind)).toEqual(['photo', 'carousel', 'reel']);
    expect((await get(colleague.token)).body.media).toHaveLength(3);
    expect((await get(outsider.token)).body).toMatchObject({ state: 'disconnected', media: [] });
    const rated = (await action(owner.token, 'sync', 'rate_limited')).body;
    expect(rated).toMatchObject({ lastError: 'rate_limited', media: refreshed.media, lastSyncedAt: refreshed.lastSyncedAt });
    expect((await action(owner.token, 'sync', 'expired')).body.state).toBe('expired');
    expect((await action(owner.token, 'sync')).body.lastError).toBe('expired');
    await action(owner.token, 'connect');
    expect((await action(owner.token, 'sync', 'changed')).body.media).toHaveLength(2);
    expect((await action(owner.token, 'disconnect')).body).toMatchObject({ state: 'disconnected', media: [] });
  } finally { await h.db.close(); }
});
