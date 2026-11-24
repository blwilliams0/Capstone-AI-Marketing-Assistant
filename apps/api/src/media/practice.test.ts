import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';
import { createLocalMediaStore, normalizePracticePhoto } from './local.js';

it('decodes the actual image, strips metadata, and rejects truncated or oversized photos', async () => {
  const input = await sharp({ create: { width: 6, height: 4, channels: 3, background: 'olive' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const photo = await normalizePracticePhoto(input, 'jpg');
  const metadata = await sharp(photo!).metadata();
  expect(metadata).toMatchObject({ width: 4, height: 6 });
  expect(metadata.exif).toBeUndefined();
  expect(await normalizePracticePhoto(input, 'png')).toBeNull();
  expect(await normalizePracticePhoto(input.subarray(0, 40), 'jpg')).toBeNull();
  const large = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'olive' } }).png().toBuffer();
  expect(await normalizePracticePhoto(large, 'png')).toBeNull();
});

it('keeps practice photo bytes private and makes replacement invalidate approval', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pocket-practice-'));
  const harness = await createHarness({ media: createLocalMediaStore(directory) });
  try {
    const contributor = await harness.addUser('contributor');
    const approver = await harness.addUser('approver');
    const viewer = await harness.addUser('viewer');
    const outsider = await harness.addUser('admin', { restaurantId: await harness.addRestaurant('Other') });
    const admin = await harness.addUser('admin');
    const proposal = await request(harness.app).post('/api/knowledge').auth(contributor.token, { type: 'bearer' })
      .send({ kind: 'fact', title: 'Practice fact', body: 'The practice patio opens at five.' });
    const sourceId = proposal.body.versionId as string;
    expect((await request(harness.app).post(`/api/knowledge/versions/${sourceId}/approve`)
      .auth(admin.token, { type: 'bearer' }).send({})).status).toBe(200);
    const post = await request(harness.app).post('/api/posts').auth(contributor.token, { type: 'bearer' })
      .send({ caption: 'The practice patio opens at five.', channel: 'instagram', audience: 'both', sourceVersionIds: [sourceId] });
    expect(post.status).toBe(201);
    const root = `/api/posts/${post.body.itemId}`;
    const jpg = await sharp({ create: { width: 6, height: 4, channels: 3, background: 'olive' } }).jpeg().toBuffer();
    const upload = (token: string, bytes = jpg) => request(harness.app).post(`${root}/media/practice`)
      .auth(token, { type: 'bearer' }).type('image/jpeg').send(bytes);
    expect((await upload(viewer.token)).status).toBe(403);
    expect((await upload(outsider.token)).status).toBe(404);
    expect((await upload(contributor.token, Buffer.from('invalid'))).status).toBe(400);
    const first = await upload(contributor.token);
    expect(first.status).toBe(201);
    const submit = await request(harness.app).post(`${root}/submit`).auth(contributor.token, { type: 'bearer' }).send({});
    expect(submit.status).toBe(201);
    const approve = await request(harness.app).post(`/api/approvals/${submit.body.approvalId}/approve`)
      .auth(approver.token, { type: 'bearer' }).send({});
    expect(approve.status).toBe(200);
    const updated = await request(harness.app).post(`/api/knowledge/${proposal.body.itemId}/versions`)
      .auth(contributor.token, { type: 'bearer' }).send({ body: 'The practice patio opens at six.' });
    expect(updated.status).toBe(201);
    expect((await request(harness.app).post(`/api/knowledge/versions/${updated.body.versionId}/approve`)
      .auth(admin.token, { type: 'bearer' }).send({})).status).toBe(200);
    const replacement = await upload(contributor.token);
    expect(replacement.status).toBe(201);
    expect(replacement.body.supersededApproval).toBe(true);
    const resubmit = await request(harness.app).post(`${root}/submit`).auth(contributor.token, { type: 'bearer' }).send({});
    expect(resubmit.status).toBe(201);
    expect((await request(harness.app).post(`/api/approvals/${resubmit.body.approvalId}/approve`)
      .auth(approver.token, { type: 'bearer' }).send({})).body.reason).toBe('stale_sources');
    const view = `${root}/media?versionId=${first.body.versionId}`;
    expect((await request(harness.app).get(view)).status).toBe(401);
    expect((await request(harness.app).get(view).auth(outsider.token, { type: 'bearer' })).status).toBe(404);
    const historical = await request(harness.app).get(view).auth(viewer.token, { type: 'bearer' });
    expect(historical.status).toBe(200);
    expect(historical.headers['cache-control']).toBe('private, no-store');
    expect(historical.headers['content-type']).toBe('image/jpeg');
  } finally {
    await harness.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
