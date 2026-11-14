import { capabilitiesFor, isRole, type Role } from '@the-pocket/shared';
import type { Db } from '@the-pocket/db';
import { recordAudit } from '../audit.js';
import type { AuthContext } from '../types.js';
import type { TokenVerifier } from './tokens.js';

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; status: 401 | 403; message: string };

/** Turns a bearer token into an authenticated caller, or explains why not. */
export interface Authenticator {
  authenticate(token: string, requestId: string): Promise<AuthResult>;
}

interface MembershipRow {
  membership_id: string;
  restaurant_id: string;
  role: string;
  status: 'invited' | 'active';
  email: string;
  name: string;
}

const NOT_SIGNED_IN: AuthResult = {
  ok: false,
  status: 401,
  message: 'Please sign in again.',
};
const NO_ACCESS: AuthResult = {
  ok: false,
  status: 403,
  message: 'Your account does not have access to this restaurant. Ask an administrator for an invitation.',
};

/**
 * Production authenticator. The role is ALWAYS read from the database membership, never from
 * token claims (user_metadata is user-editable and must not be trusted). Revoked members are
 * refused on their very next request.
 */
export function createSupabaseAuthenticator(verifier: TokenVerifier, db: Db): Authenticator {
  return {
    async authenticate(token, requestId) {
      const verified = await verifier.verify(token);
      if (!verified) return NOT_SIGNED_IN;

      const rows = await db.query<MembershipRow>(
        `SELECT m.id AS membership_id, m.restaurant_id, m.role, m.status, p.email, p.name
           FROM memberships m JOIN profiles p ON p.user_id = m.user_id
          WHERE m.user_id = $1 AND m.status IN ('invited', 'active')
          ORDER BY m.created_at ASC LIMIT 1`,
        [verified.userId],
      );
      const row = rows[0];
      if (!row || !isRole(row.role)) return NO_ACCESS;

      // A valid token for an invited user proves they accepted the invitation (Supabase only
      // issues tokens after the invite link is used), so activate the membership.
      if (row.status === 'invited') {
        await db.transaction(async (tx) => {
          await tx.query(`UPDATE memberships SET status = 'active' WHERE id = $1 AND status = 'invited'`, [
            row.membership_id,
          ]);
          await recordAudit(tx, {
            restaurantId: row.restaurant_id,
            actorUserId: verified.userId,
            action: 'member.activated',
            targetType: 'membership',
            targetId: row.membership_id,
            requestId,
          });
        });
      }

      return {
        ok: true,
        auth: {
          userId: verified.userId,
          email: row.email,
          name: row.name,
          restaurantId: row.restaurant_id,
          membershipId: row.membership_id,
          role: row.role,
          capabilities: capabilitiesFor(row.role),
        },
      };
    },
  };
}

const MOCK_RESTAURANT_ID = '00000000-0000-0000-0000-00000000d3a0';

/**
 * LOCAL DEVELOPMENT ONLY. Accepts "Bearer mock:<role>". loadConfig() refuses to start with
 * AUTH_MODE=mock unless NODE_ENV is development or test, so this can never run in production.
 */
export function createMockAuthenticator(): Authenticator {
  return {
    async authenticate(token) {
      const match = /^mock:(\w+)$/.exec(token);
      const role = match?.[1];
      if (!role || !isRole(role)) return NOT_SIGNED_IN;
      return { ok: true, auth: mockContext(role) };
    },
  };
}

function mockContext(role: Role): AuthContext {
  return {
    userId: `00000000-0000-0000-0000-0000000000${String(['admin', 'approver', 'contributor', 'viewer'].indexOf(role) + 1).padStart(2, '0')}`,
    email: `mock-${role}@example.invalid`,
    name: `Mock ${role}`,
    restaurantId: MOCK_RESTAURANT_ID,
    membershipId: `mock-membership-${role}`,
    role,
    capabilities: capabilitiesFor(role),
  };
}
