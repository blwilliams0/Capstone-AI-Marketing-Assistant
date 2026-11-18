import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHarness, ISSUER, type Harness } from './testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});

const get = (path: string, token?: string) => {
  const r = request(h.app).get(path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

describe('authentication', () => {
  it('health check is public', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects requests without a token', async () => {
    expect((await get('/api/me')).status).toBe(401);
  });

  it('rejects malformed and garbage tokens', async () => {
    const res1 = await request(h.app).get('/api/me').set('Authorization', 'Basic abc');
    expect(res1.status).toBe(401);
    expect((await get('/api/me', 'not-a-jwt')).status).toBe(401);
    expect((await get('/api/me', 'mock:admin')).status).toBe(401); // mock tokens do nothing in real mode
  });

  it('rejects expired tokens', async () => {
    const u = await h.addUser('admin');
    expect((await get('/api/me', await h.sign(u.userId, { expiresIn: '-1m' }))).status).toBe(401);
  });

  it('rejects tokens from the wrong issuer or audience', async () => {
    const u = await h.addUser('admin');
    expect((await get('/api/me', await h.sign(u.userId, { issuer: 'https://evil.example/auth/v1' }))).status).toBe(401);
    expect((await get('/api/me', await h.sign(u.userId, { audience: 'someone-else' }))).status).toBe(401);
    expect(ISSUER).toContain('supabase.co');
  });

  it('rejects tokens signed with a different key', async () => {
    const u = await h.addUser('admin');
    expect((await get('/api/me', await h.signWithForeignKey(u.userId))).status).toBe(401);
  });

  it('returns the caller identity, role and capabilities from the database', async () => {
    const u = await h.addUser('contributor');
    const res = await get('/api/me', u.token);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('contributor');
    expect(res.body.capabilities).toContain('content.draft');
    expect(res.body.capabilities).not.toContain('users.invite');
  });

  it('gives a valid token with no membership a 403, not access', async () => {
    const res = await get('/api/me', await h.sign('99999999-9999-4999-8999-999999999999'));
    expect(res.status).toBe(403);
  });

  it('refuses revoked members', async () => {
    const u = await h.addUser('admin', { status: 'revoked' });
    expect((await get('/api/me', u.token)).status).toBe(403);
  });

  it('ignores role claims inside the token (forged user_metadata/app_metadata)', async () => {
    const viewer = await h.addUser('viewer');
    const forged = await h.sign(viewer.userId, {
      claims: { user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' }, role_claim: 'admin' },
    });
    const me = await get('/api/me', forged);
    expect(me.body.role).toBe('viewer');
    expect((await get('/api/admin/members', forged)).status).toBe(403);
  });

  it('activates an invited member on their first valid sign-in and audits it', async () => {
    const u = await h.addUser('viewer', { status: 'invited' });
    expect((await get('/api/me', u.token)).status).toBe(200);
    const [m] = await h.db.query<{ status: string }>('SELECT status FROM memberships WHERE id = $1', [u.membershipId]);
    expect(m!.status).toBe('active');
    const events = await h.db.query('SELECT 1 FROM audit_events WHERE action = $1 AND target_id = $2', [
      'member.activated',
      u.membershipId,
    ]);
    expect(events).toHaveLength(1);
  });

  it('unknown routes return 404 JSON without leaking details', async () => {
    const u = await h.addUser('admin');
    const res = await get('/api/does-not-exist', u.token);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/);
  });

  it('only allows the configured web origin via CORS', async () => {
    const ok = await request(h.app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(h.app).get('/health').set('Origin', 'https://evil.example');
    // The browser enforces the mismatch; the server must never allow '*' or echo the attacker's origin.
    expect(bad.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(bad.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(bad.headers['access-control-allow-origin']).not.toBe('*');
  });
});
