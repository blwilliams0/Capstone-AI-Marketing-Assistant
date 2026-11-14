import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface VerifiedToken {
  userId: string;
  email?: string;
}

/** Verifies a bearer token. Returns null for anything invalid, expired or from the wrong issuer. */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}

export function createJwtVerifier(opts: {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
}): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, opts.keys, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ['ES256', 'RS256', 'EdDSA'],
        });
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
        return {
          userId: payload.sub,
          email: typeof payload.email === 'string' ? payload.email : undefined,
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Verifies Supabase Auth JWTs against the project's public signing keys (JWKS), so the API holds
 * no signing secret. Requires the Supabase project to use asymmetric JWT signing keys.
 */
export function createSupabaseVerifier(supabaseUrl: string): TokenVerifier {
  const base = supabaseUrl.replace(/\/+$/, '');
  return createJwtVerifier({
    issuer: `${base}/auth/v1`,
    audience: 'authenticated',
    keys: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`)),
  });
}
