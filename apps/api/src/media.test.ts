import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { sniffImageType, type MediaStore } from './media/store.js';
import { createHarness, type Harness } from './testing/harness.js';

// In-memory stand-in for Supabase Storage.
const objects = new Map<string, Uint8Array>();
const links: string[] = [];
const store: MediaStore = {
  async createUploadLink(path) {
    links.push(path);
    return { path, token: `token-for-${path}` };
  },
  async download(path, maxBytes) {
    const b = objects.get(path);
    if (!b) return null;
    return b.length > maxBytes ? 'too_large' : b;
  },
  async viewLink(path, seconds, o = {}) {
    return `https://storage.test/${path}?expires=${seconds}${o.download ? '&download' : ''}`;
  },
  async remove(path) {
    objects.delete(path);
  },
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));

let h: Harness;
type U = Awaited<ReturnType<Harness['addUser']>>;
let approver: U, contributor: U, viewer: U, outsider: U;

const as = (u: U) => ({
  get: (p: string) => request(h.app).get(p).set('Authorization', `Bearer ${u.token}`),
  post: (p: string, body: object = {}) => request(h.app).post(p).set('Authorization', `Bearer ${u.token}`).send(body),
});

async function newPost() {
  const res = await as(contributor).post('/api/posts', { channel: 'instagram', audience: 'both', caption: 'Patio tonight.' });
  return res.body.itemId as string;
}
async function upload(itemId: string, bytes: Uint8Array, contentType = 'image/jpeg') {
  const link = await as(contributor).post(`/api/posts/${itemId}/media/upload-link`, { contentType });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  objects.set(link.body.path, bytes);
  return link.body.path as string;
}

beforeAll(async () => {
  h = await createHarness({ media: store });
  approver = await h.addUser('approver');
  contributor = await h.addUser('contributor');
  viewer = await h.addUser('viewer');
  outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Other') });
});

describe('photo upload', () => {
  it('gives a one-time link to a fresh path inside this restaurant and post; viewers cannot upload', async () => {
    const id = await newPost();
    const res = await as(contributor).post(`/api/posts/${id}/media/upload-link`, { contentType: 'image/png' });
    expect(res.body.path).toMatch(new RegExp(`^${h.restaurantId}/${id}/[0-9a-f-]{36}\\.png$`));
    expect(res.body.bucket).toBe('post-media');
    expect((await as(viewer).post(`/api/posts/${id}/media/upload-link`, { contentType: 'image/png' })).status).toBe(403);
    expect((await as(contributor).post(`/api/posts/${id}/media/upload-link`, { contentType: 'image/gif' })).status).toBe(400);
    expect((await as(outsider).post(`/api/posts/${id}/media/upload-link`, { contentType: 'image/png' })).status).toBe(404);
  });

  it('checks the file itself, fingerprints it, and saves it as a new version that needs approval again', async () => {
    const id = await newPost();
    const sub = await as(contributor).post(`/api/posts/${id}/submit`);
    await as(approver).post(`/api/approvals/${sub.body.approvalId}/approve`);

    const path = await upload(id, JPEG);
    const res = await as(contributor).post(`/api/posts/${id}/media`, { path });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.sha256).toBe(createHash('sha256').update(JPEG).digest('hex'));
    expect(res.body.supersededApproval).toBe(true);

    const d = (await as(viewer).get(`/api/posts/${id}`)).body;
    expect(d.status).toBe('draft');
    expect(d.versions[0].media).toEqual({ sha256: res.body.sha256 });
    expect(d.versions[0].caption).toBe('Patio tonight.'); // text unchanged
    expect(d.versions[0].digest).not.toBe(d.versions[1].digest); // the photo is part of what is approved

    const view = await as(viewer).get(`/api/posts/${id}/media?versionId=${d.versions[0].id}`);
    expect(view.body.url).toMatch(/expires=300/);
    expect((await as(outsider).get(`/api/posts/${id}/media?versionId=${d.versions[0].id}`)).status).toBe(404);

    expect((await as(viewer).get(`/api/posts/${id}/media?versionId=${d.versions[0].id}&download=1`)).body.url).toMatch(/&download$/);

    const removed = await as(contributor).post(`/api/posts/${id}/media/remove`);
    expect(removed.status).toBe(201);
    expect((await as(viewer).get(`/api/posts/${id}`)).body.versions[0].media).toBeNull();
    // Removing again does nothing (no new version, so no approval is cancelled).
    expect((await as(contributor).post(`/api/posts/${id}/media/remove`)).body.reason).toBe('no_photo');
  });

  it('blocks approval and posting if the stored photo no longer matches its fingerprint', async () => {
    const id = await newPost();
    const path = await upload(id, JPEG);
    await as(contributor).post(`/api/posts/${id}/media`, { path });
    const sub = await as(contributor).post(`/api/posts/${id}/submit`);

    objects.set(path, PNG); // changed behind the app's back
    expect((await as(approver).post(`/api/approvals/${sub.body.approvalId}/approve`)).body.reason).toBe('photo_changed');

    objects.set(path, JPEG); // restored: approval goes through
    expect((await as(approver).post(`/api/approvals/${sub.body.approvalId}/approve`)).status).toBe(200);

    objects.delete(path); // removed before posting
    const posted = await as(contributor).post(`/api/approvals/${sub.body.approvalId}/posted`, { digest: sub.body.digest });
    expect(posted.body.reason).toBe('photo_changed');
  });

  it('refuses paths from another post, files not uploaded, non-images, and mismatched types', async () => {
    const id = await newPost();
    const other = await newPost();
    const otherPath = await upload(other, JPEG);
    expect((await as(contributor).post(`/api/posts/${id}/media`, { path: otherPath })).body.reason).toBe('bad_path');
    expect((await as(contributor).post(`/api/posts/${id}/media`, { path: '../../etc/passwd' })).body.reason).toBe('bad_path');

    const missing = (await as(contributor).post(`/api/posts/${id}/media/upload-link`, { contentType: 'image/jpeg' })).body.path;
    expect((await as(contributor).post(`/api/posts/${id}/media`, { path: missing })).body.reason).toBe('not_uploaded');

    const script = await upload(id, new TextEncoder().encode('<script>alert(1)</script>'));
    expect((await as(contributor).post(`/api/posts/${id}/media`, { path: script })).body.reason).toBe('not_an_image');
    expect(objects.has(script)).toBe(false); // rejected files are deleted

    const pngAsJpeg = await upload(id, PNG, 'image/jpeg');
    expect((await as(contributor).post(`/api/posts/${id}/media`, { path: pngAsJpeg })).body.reason).toBe('not_an_image');

    const big = await upload(id, new Uint8Array(10 * 1024 * 1024 + 1).fill(0xff));
    expect((await as(contributor).post(`/api/posts/${id}/media`, { path: big })).status).toBe(413);
  });

  it('a posted post cannot get a new photo', async () => {
    const id = await newPost();
    const sub = await as(contributor).post(`/api/posts/${id}/submit`);
    await as(approver).post(`/api/approvals/${sub.body.approvalId}/approve`);
    await as(contributor).post(`/api/approvals/${sub.body.approvalId}/posted`, { digest: sub.body.digest });
    expect((await as(contributor).post(`/api/posts/${id}/media/upload-link`, { contentType: 'image/jpeg' })).status).toBe(409);
  });

  it('without storage configured, photo routes answer 503', async () => {
    const plain = await createHarness();
    const u = await plain.addUser('contributor');
    const res = await request(plain.app).post(`/api/posts/00000000-0000-4000-8000-000000000000/media/upload-link`).set('Authorization', `Bearer ${u.token}`).send({ contentType: 'image/jpeg' });
    expect(res.status).toBe(503);
  });
});

describe('image type detection', () => {
  it('recognises JPEG, PNG and WebP by their bytes, and nothing else', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
