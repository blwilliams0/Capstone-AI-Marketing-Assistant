import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

it('shares only explicitly included photos and preserves revision order without granting through a feed', async () => {
  const h = await createHarness();
  try {
    const owner = await h.addUser('admin');
    const peer = await h.addUser('contributor');
    const outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Other') });
    const as = (token: string) => ({
      get: (path: string) => request(h.app).get(path).auth(token, { type: 'bearer' }),
      post: (path: string) => request(h.app).post(path).auth(token, { type: 'bearer' }),
    });
    const base = '/api/visual/collections';
    const photo = await sharp({ create: { width: 12, height: 10, channels: 3, background: 'olive' } }).jpeg().toBuffer();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      expect((await as(owner.token).post('/api/visual/assets').type('image/jpeg')
        .set('x-photo-id', id).set('x-photo-label', 'Fictional').send(photo)).status).toBe(201);
    }
    const image = '/api/visual/assets/' + ids[0] + '/image';
    const items = ids.map((assetId) => ({ assetId }));
    const album = { kind: 'album', name: 'Team photos', visibility: 'management', items };
    const feed = { kind: 'feed', name: 'Grid', visibility: 'team', items };
    expect((await as(peer.token).get(image)).status).toBe(404);
    expect((await as(peer.token).post(base).send(album)).status).toBe(403);
    const restricted = await as(owner.token).post(base).send(album);
    expect(restricted.status).toBe(201);
    expect((await as(peer.token).get(base + '?kind=album')).body.collections).toHaveLength(10);
    expect((await as(owner.token).post(base).send(feed)).status).toBe(400);
    const shared = await as(owner.token).post(base + '?id=' + restricted.body.id)
      .send({ ...album, visibility: 'team', revision: 1 });
    expect(shared.status).toBe(200);
    expect((await as(peer.token).get(image)).status).toBe(200);
    expect((await as(outsider.token).get(image)).status).toBe(404);
    expect((await as(peer.token).post(base).send({ ...album, visibility: 'team' })).status).toBe(400);
    const created = await as(owner.token).post(base).send(feed);
    expect(created.status).toBe(201);
    const path = base + '?id=' + created.body.id;
    expect((await as(peer.token).post(path).send({ ...feed, revision: 1 })).status).toBe(404);
    const update = { ...feed, items: [...items].reverse(), revision: 1 };
    const concurrent = await Promise.all([as(owner.token).post(path).send(update), as(owner.token).post(path).send(update)]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await as(peer.token).get(base + '?kind=feed')).body.collections[0].items.map((item: { assetId: string }) => item.assetId)).toEqual([...ids].reverse());
    expect((await as(outsider.token).get(base + '?kind=feed')).body.collections).toEqual([]);
    expect((await as(owner.token).post(base + '?id=' + restricted.body.id)
      .send({ ...album, visibility: 'team', revision: 2, items: [items[1]] })).status).toBe(200);
    expect((await as(peer.token).get(image)).status).toBe(404);
    expect((await as(owner.token).get(image)).status).toBe(200);
    expect((await as(peer.token).get(base + '?kind=feed')).body.collections[0].items).toHaveLength(1);
  } finally { await h.db.close(); }
});

it('initializes defaults for new tenants and preserves renamed and archived defaults', async () => {
  const h = await createHarness();
  try {
    const tenant = await h.addRestaurant('Fictional restaurant');
    const admin = await h.addUser('admin', { restaurantId: tenant });
    const contributor = await h.addUser('contributor', { restaurantId: tenant });
    const base = '/api/visual/collections';
    const list = (token: string) => request(h.app).get(base + '?kind=album').auth(token, { type: 'bearer' });
    const post = (path: string, token: string) => request(h.app).post(path).auth(token, { type: 'bearer' });
    const albums = (await list(contributor.token)).body.collections;
    expect(albums).toHaveLength(10);
    expect(albums.every((item: { editable: boolean; items: unknown[] }) => !item.editable && !item.items.length)).toBe(true);
    const patio = albums.find((item: { name: string }) => item.name === 'The Patio');
    const archive = base + '/' + patio.id + '/archive';
    const edit = { kind: 'album', name: 'Patio photos', visibility: 'management', revision: 1, items: [] };
    expect((await post(base + '?id=' + patio.id, contributor.token).send(edit)).status).toBe(403);
    expect((await post(base + '?id=' + patio.id, admin.token).send(edit)).status).toBe(200);
    expect((await list(contributor.token)).body.collections).toHaveLength(9);
    expect((await post(archive, contributor.token).send({ revision: 2 })).status).toBe(403);
    expect((await post(archive, admin.token).send({ revision: 1 })).status).toBe(409);
    expect((await post(archive, admin.token).send({ revision: 2 })).status).toBe(200);
    await h.db.query('SELECT initialize_default_media_albums($1)', [tenant]);
    expect((await list(admin.token)).body.collections).toHaveLength(9);
    expect(await h.db.query('SELECT name FROM visual_collections WHERE id = $1', [patio.id])).toEqual([{ name: 'Patio photos' }]);
  } finally { await h.db.close(); }
});
