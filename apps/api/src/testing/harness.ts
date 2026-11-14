import { randomUUID } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import type { Db } from '@the-pocket/db';
import { createTestDb } from '@the-pocket/db/testing';
import type { Role } from '@the-pocket/shared';
import { createApp } from '../app.js';
import type { AuthAdmin } from '../auth/auth-admin.js';
import { createSupabaseAuthenticator } from '../auth/authenticator.js';
import { createJwtVerifier } from '../auth/tokens.js';

export const ISSUER = 'https://test-project.supabase.co/auth/v1';
export const AUDIENCE = 'authenticated';
export const WEB_ORIGIN = 'http://localhost:5173';

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export interface Harness {
  db: Db;
  app: ReturnType<typeof createApp>['app'];
  policies: ReturnType<typeof createApp>['policies'];
  restaurantId: string;
  invites: { email: string; name: string; userId: string }[];
  /** Create a user + profile + membership. Returns a valid signed token for them. */
  addUser(role: Role, opts?: { status?: 'invited' | 'active' | 'revoked'; restaurantId?: string }): Promise<{ userId: string; membershipId: string; token: string; email: string }>;
  /** Create a restaurant (for tenant-isolation tests). */
  addRestaurant(name: string): Promise<string>;
  /** Sign a token for any user id. Override anything to make it invalid. */
  sign(userId: string, overrides?: SignOverrides): Promise<string>;
  signWithForeignKey(userId: string): Promise<string>;
}

export interface SignOverrides {
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  claims?: Record<string, unknown>;
}

export async function createHarness(opts: { withAuthAdmin?: boolean } = {}): Promise<Harness> {
  const withAuthAdmin = opts.withAuthAdmin ?? true;
  const db = await createTestDb();
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const verifier = createJwtVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) });
  const foreign = await generateKeyPair('ES256');

  const invites: Harness['invites'] = [];
  const authAdmin: AuthAdmin = {
    async inviteUserByEmail(email, name) {
      const userId = randomUUID();
      await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [userId, email]);
      invites.push({ email, name, userId });
      return { userId };
    },
  };

  const { app, policies } = createApp({
    db,
    authenticator: createSupabaseAuthenticator(verifier, db),
    authAdmin: withAuthAdmin ? authAdmin : undefined,
    webOrigin: WEB_ORIGIN,
  });

  const [restaurant] = await db.query<{ id: string }>(`INSERT INTO restaurants (name) VALUES ('Test Restaurant') RETURNING id`);
  const restaurantId = restaurant!.id;

  async function signWith(key: Key, kid: string, userId: string, o: SignOverrides = {}) {
    return new SignJWT({ role: 'authenticated', ...(o.claims ?? {}) })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject(userId)
      .setIssuer(o.issuer ?? ISSUER)
      .setAudience(o.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(o.expiresIn ?? '1h')
      .sign(key);
  }
  const sign = (userId: string, o?: SignOverrides) => signWith(privateKey, 'test-key', userId, o);

  return {
    db,
    app,
    policies,
    restaurantId,
    invites,
    sign,
    signWithForeignKey: (userId) => signWith(foreign.privateKey, 'test-key', userId),
    async addRestaurant(name) {
      const [r] = await db.query<{ id: string }>('INSERT INTO restaurants (name) VALUES ($1) RETURNING id', [name]);
      return r!.id;
    },
    async addUser(role, o = {}) {
      const userId = randomUUID();
      const email = `${role}-${userId.slice(0, 8)}@example.test`;
      const status = o.status ?? 'active';
      await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [userId, email]);
      await db.query('INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3)', [userId, email, `Test ${role}`]);
      const [m] = await db.query<{ id: string }>(
        `INSERT INTO memberships (restaurant_id, user_id, role, status, revoked_at, revoked_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          o.restaurantId ?? restaurantId,
          userId,
          role,
          status,
          status === 'revoked' ? new Date().toISOString() : null,
          status === 'revoked' ? userId : null,
        ],
      );
      return { userId, membershipId: m!.id, email, token: await sign(userId) };
    },
  };
}
