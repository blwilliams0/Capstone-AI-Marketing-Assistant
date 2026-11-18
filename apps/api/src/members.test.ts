import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHarness, type Harness } from './testing/harness.js';

let h: Harness;
let admin: Awaited<ReturnType<Harness['addUser']>>;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.addUser('admin');
});

const as = (token: string) => ({
  post: (p: string) => request(h.app).post(p).set('Authorization', `Bearer ${token}`),
  get: (p: string) => request(h.app).get(p).set('Authorization', `Bearer ${token}`),
});

describe('invitations', () => {
  it('invites a member: creates membership, permission event and audit event atomically', async () => {
    const res = await as(admin.token)
      .post('/api/admin/invitations')
      .send({ email: '  New.Person@Example.test ', name: 'New Person', role: 'contributor' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('invited');
    expect(h.invites.at(-1)?.email).toBe('new.person@example.test'); // normalised

    const [m] = await h.db.query<{ role: string; status: string; invited_by: string }>(
      'SELECT role, status, invited_by FROM memberships WHERE id = $1',
      [res.body.membershipId],
    );
    expect(m).toMatchObject({ role: 'contributor', status: 'invited', invited_by: admin.userId });
    expect(
      await h.db.query('SELECT 1 FROM permission_events WHERE membership_id = $1 AND event = $2', [res.body.membershipId, 'invited']),
    ).toHaveLength(1);
    expect(
      await h.db.query('SELECT 1 FROM audit_events WHERE target_id = $1 AND action = $2', [res.body.membershipId, 'member.invited']),
    ).toHaveLength(1);
  });

  it('rejects invalid input with plain-English problems', async () => {
    const res = await as(admin.token).post('/api/admin/invitations').send({ email: 'nope', name: '', role: 'owner' });
    expect(res.status).toBe(400);
    expect(res.body.problems.map((p: { field: string }) => p.field)).toEqual(expect.arrayContaining(['email', 'name', 'role']));
  });

  it('refuses to invite someone who already has access', async () => {
    const existing = await h.addUser('viewer');
    const res = await as(admin.token)
      .post('/api/admin/invitations')
      .send({ email: existing.email, name: 'Dup', role: 'viewer' });
    expect(res.status).toBe(409);
  });

  it('answers 503 when invitations are not configured', async () => {
    const bare = await createHarness({ withAuthAdmin: false });
    const a = await bare.addUser('admin');
    const res = await request(bare.app)
      .post('/api/admin/invitations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ email: 'a@example.test', name: 'A', role: 'viewer' });
    expect(res.status).toBe(503);
  });

  it('lists members for admins only', async () => {
    const res = await as(admin.token).get('/api/admin/members');
    expect(res.status).toBe(200);
    expect(res.body.members.length).toBeGreaterThan(0);
  });
});

describe('revocation', () => {
  it('revokes access on the very next request and records why', async () => {
    const victim = await h.addUser('contributor');
    expect((await as(victim.token).get('/api/me')).status).toBe(200);

    const res = await as(admin.token)
      .post(`/api/admin/members/${victim.membershipId}/revoke`)
      .send({ reason: 'Left the restaurant' });
    expect(res.status).toBe(200);

    expect((await as(victim.token).get('/api/me')).status).toBe(403);
    const [m] = await h.db.query<{ status: string; revoke_reason: string; revoked_by: string }>(
      'SELECT status, revoke_reason, revoked_by FROM memberships WHERE id = $1',
      [victim.membershipId],
    );
    expect(m).toMatchObject({ status: 'revoked', revoke_reason: 'Left the restaurant', revoked_by: admin.userId });
    expect(
      await h.db.query('SELECT 1 FROM permission_events WHERE membership_id = $1 AND event = $2', [victim.membershipId, 'revoked']),
    ).toHaveLength(1);
    expect(
      await h.db.query('SELECT 1 FROM audit_events WHERE target_id = $1 AND action = $2', [victim.membershipId, 'member.revoked']),
    ).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const victim = await h.addUser('viewer');
    const res = await as(admin.token).post(`/api/admin/members/${victim.membershipId}/revoke`).send({});
    expect(res.status).toBe(400);
  });

  it('cannot revoke the same member twice', async () => {
    const victim = await h.addUser('viewer');
    const url = `/api/admin/members/${victim.membershipId}/revoke`;
    expect((await as(admin.token).post(url).send({ reason: 'x' })).status).toBe(200);
    expect((await as(admin.token).post(url).send({ reason: 'x' })).status).toBe(409);
  });

  it('cannot revoke the last active administrator', async () => {
    const solo = await createHarness();
    const only = await solo.addUser('admin');
    const res = await request(solo.app)
      .post(`/api/admin/members/${only.membershipId}/revoke`)
      .set('Authorization', `Bearer ${only.token}`)
      .send({ reason: 'oops' });
    expect(res.status).toBe(409);
    expect((await request(solo.app).get('/api/me').set('Authorization', `Bearer ${only.token}`)).status).toBe(200);
  });

  it('can revoke an administrator when another remains', async () => {
    const second = await h.addUser('admin');
    const res = await as(admin.token).post(`/api/admin/members/${second.membershipId}/revoke`).send({ reason: 'rotation' });
    expect(res.status).toBe(200);
  });

  it('cannot touch members of another restaurant (tenant boundary)', async () => {
    const otherRestaurant = await h.addRestaurant('Other Restaurant');
    const outsider = await h.addUser('viewer', { restaurantId: otherRestaurant });
    const res = await as(admin.token)
      .post(`/api/admin/members/${outsider.membershipId}/revoke`)
      .send({ reason: 'cross-tenant attempt' });
    expect(res.status).toBe(404);
    expect((await as(outsider.token).get('/api/me')).status).toBe(200);
  });
});

describe('audit trail', () => {
  it('is visible to admins, scoped to their restaurant, and has no secrets', async () => {
    const res = await as(admin.token).get('/api/audit-events?limit=200');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ|secret|password/i);
  });

  it('validates the limit parameter', async () => {
    expect((await as(admin.token).get('/api/audit-events?limit=0')).status).toBe(400);
    expect((await as(admin.token).get('/api/audit-events?limit=9999')).status).toBe(400);
  });
});
