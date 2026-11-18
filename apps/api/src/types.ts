import type { Capability, Role } from '@the-pocket/shared';

/** The authenticated caller, resolved from a verified token plus the database. Never from the token's role claims. */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  restaurantId: string;
  membershipId: string;
  role: Role;
  capabilities: readonly Capability[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
