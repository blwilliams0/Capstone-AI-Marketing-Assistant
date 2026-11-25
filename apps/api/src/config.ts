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
  /** Server-only. When absent, AI uses the mock in development/test and is disabled elsewhere. */
  anthropicApiKey?: string;
  aiMode: 'claude' | 'mock' | 'disabled';
  aiMonthlyBudgetUsd: number;
  livePhotoAdvice: boolean;
  liveReferenceImages: boolean;
  evaluationMaxCalls?: number;
}

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  AUTH_MODE: z.enum(['supabase', 'mock']).default('supabase'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_ISOLATED_EVALUATION: z.enum(['true', 'false']).default('false'),
  AI_LIVE_REFERENCE_IMAGES: z.enum(['true', 'false']).default('false'),
  AI_EVALUATION_MAX_CALLS: z.coerce.number().int().min(1).max(20).default(5),
  AI_LIVE_PHOTO_ADVICE: z.enum(['true', 'false']).default('false'),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).max(10_000).default(25),
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

  const anthropicApiKey = e.ANTHROPIC_API_KEY?.trim() || undefined;
  const evaluation = e.AI_ISOLATED_EVALUATION === 'true';
  if (evaluation && (!anthropicApiKey || nodeEnv !== 'development' || e.AUTH_MODE !== 'mock'
    || e.DATABASE_URL !== 'postgresql://pocket_preview@127.0.0.1:55437/postgres'
    || e.WEB_ORIGIN !== 'http://127.0.0.1:5173' || e.SUPABASE_URL || e.SUPABASE_SECRET_KEY
    || e.AI_MONTHLY_BUDGET_USD <= 0 || e.AI_MONTHLY_BUDGET_USD > 5)) {
    throw new Error('Live evaluation requires the isolated development launcher, an authorized key, and an estimated monthly budget above zero and at most $5.');
  }
  const aiMode = anthropicApiKey && (e.AUTH_MODE !== 'mock' || evaluation) ? 'claude' : MOCK_ALLOWED_ENVS.includes(nodeEnv) ? 'mock' : 'disabled';

  return {
    nodeEnv,
    port: e.API_PORT,
    webOrigin: e.WEB_ORIGIN,
    authMode: e.AUTH_MODE,
    supabaseUrl: e.SUPABASE_URL,
    supabaseSecretKey: e.SUPABASE_SECRET_KEY,
    databaseUrl: e.DATABASE_URL,
    anthropicApiKey,
    aiMode,
    livePhotoAdvice: e.AI_LIVE_PHOTO_ADVICE === 'true' && aiMode === 'claude',
    liveReferenceImages: e.AI_LIVE_REFERENCE_IMAGES === 'true' && e.AI_LIVE_PHOTO_ADVICE === 'true' && aiMode === 'claude',
    evaluationMaxCalls: evaluation ? e.AI_EVALUATION_MAX_CALLS : undefined,
    aiMonthlyBudgetUsd: e.AI_MONTHLY_BUDGET_USD,
  };
}
