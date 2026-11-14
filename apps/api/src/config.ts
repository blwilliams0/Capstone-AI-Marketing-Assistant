import { z } from 'zod';

export type AuthMode = 'supabase' | 'mock';

export interface Config {
  nodeEnv: string;
  port: number;
  webOrigin: string;
  authMode: AuthMode;
  supabaseUrl?: string;
  /** Server-only. Needed for invitations. Never sent to the browser. */
  supabaseSecretKey?: string;
  /** Server-only. */
  databaseUrl?: string;
}

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  AUTH_MODE: z.enum(['supabase', 'mock']).default('supabase'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
});

/** Environments in which mock authentication may ever run. Anything else is treated as production. */
const MOCK_ALLOWED_ENVS = ['development', 'test'];

/**
 * Parses and validates environment variables. Fails closed: mock authentication is refused unless
 * NODE_ENV is explicitly "development" or "test" (an unset NODE_ENV counts as production).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  const nodeEnv = e.NODE_ENV ?? 'production';

  if (e.AUTH_MODE === 'mock' && !MOCK_ALLOWED_ENVS.includes(nodeEnv)) {
    throw new Error(
      'Refusing to start: AUTH_MODE=mock is only allowed when NODE_ENV is "development" or "test".',
    );
  }
  if (e.AUTH_MODE === 'supabase') {
    const missing = (['SUPABASE_URL', 'DATABASE_URL'] as const).filter((k) => !e[k]);
    if (missing.length > 0) {
      throw new Error(`Invalid configuration: ${missing.join(', ')} required when AUTH_MODE=supabase.`);
    }
  }

  return {
    nodeEnv,
    port: e.API_PORT,
    webOrigin: e.WEB_ORIGIN,
    authMode: e.AUTH_MODE,
    supabaseUrl: e.SUPABASE_URL,
    supabaseSecretKey: e.SUPABASE_SECRET_KEY,
    databaseUrl: e.DATABASE_URL,
  };
}
