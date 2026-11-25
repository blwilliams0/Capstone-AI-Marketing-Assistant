import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { ROLES, roleHas, type Role } from '@the-pocket/shared';
import { createHarness, type Harness } from './testing/harness.js';

let h: Harness;
const tokens = {} as Record<Role, string>;

beforeAll(async () => {
  // This suite sends every role through every route from one test IP.
  h = await createHarness({ rateLimits: { perIp: { max: 1000, windowMs: 5 * 60 * 1000 } } });
  for (const role of ROLES) tokens[role] = (await h.addUser(role)).token;
});

describe('permission matrix, enforced by the backend on every registered route', () => {
  it('registers at least the Stage 1 routes', () => {
    const keys = h.policies.routes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'get /me',
        'get /admin/members',
        'post /admin/invitations',
        'post /admin/members/:id/revoke',
        'get /audit-events',
        'get /knowledge',
        'post /knowledge',
        'post /knowledge/versions/:versionId/approve',
        'post /knowledge/versions/:versionId/reject',
        'post /knowledge/:itemId/retire',
        'post /knowledge/:itemId/brand-core',
      ]),
    );
  });

  it('every route denies roles lacking its capability and never denies roles that have it', async () => {
    for (const route of h.policies.routes) {
      for (const role of ROLES) {
        const path = '/api' + route.path.replace(/:\w+/g, 'not-a-uuid');
        // Empty body: authorized callers get a harmless 400/200 from validation, never a side effect.
        const res = await request(h.app)[route.method](path).set('Authorization', `Bearer ${tokens[role]}`).send({});
        const allowed = route.policy === 'member' || roleHas(role, route.policy);
        const label = `${role} ${route.method.toUpperCase()} ${route.path}`;
        if (allowed) expect([401, 403], label).not.toContain(res.status);
        else expect(res.status, label).toBe(403);
      }
    }
  });

  it('admin-only actions are denied to contributor, viewer and approver explicitly', async () => {
    for (const role of ['contributor', 'viewer', 'approver'] as const) {
      const invite = await request(h.app)
        .post('/api/admin/invitations')
        .set('Authorization', `Bearer ${tokens[role]}`)
        .send({ email: 'x@example.test', name: 'X', role: 'admin' });
      expect(invite.status, `${role} invite`).toBe(403);
      const audit = await request(h.app).get('/api/audit-events').set('Authorization', `Bearer ${tokens[role]}`);
      expect(audit.status, `${role} audit`).toBe(403);
    }
  });

  it('a contributor cannot create an admin by any invitation route', async () => {
    const before = await h.db.query('SELECT 1 FROM memberships');
    await request(h.app)
      .post('/api/admin/invitations')
      .set('Authorization', `Bearer ${tokens.contributor}`)
      .send({ email: 'sneaky@example.test', name: 'Sneaky', role: 'admin' });
    const after = await h.db.query('SELECT 1 FROM memberships');
    expect(after.length).toBe(before.length);
    expect(h.invites.find((i) => i.email === 'sneaky@example.test')).toBeUndefined();
  });
});
