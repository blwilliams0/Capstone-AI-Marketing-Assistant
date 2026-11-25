import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Db } from '@the-pocket/db';
import type { Authenticator } from './auth/authenticator.js';
import type { AuthAdmin } from './auth/auth-admin.js';
import {
  authenticate,
  errorHandler,
  notFound,
  rateLimit,
  requestId,
  requestLogger,
  type RateLimitOptions,
} from './middleware.js';
import { buildRoutes } from './routes.js';
import type { PolicyRouter } from './policy.js';
import type { AiProvider } from './ai/provider.js';
import type { MediaStore } from './media/store.js';

export interface AppDeps {
  db: Db;
  authenticator: Authenticator;
  authAdmin?: AuthAdmin;
  webOrigin: string;
  /** Override limits (tests). Defaults: 300 requests per 5 minutes per IP and per signed-in user. */
  rateLimits?: { perIp?: RateLimitOptions; perUser?: RateLimitOptions; ai?: RateLimitOptions };
  /** The AI provider, or null when none is configured. Defaults to null. */
  ai?: AiProvider | null;
  /** Private photo storage; absent when the Supabase secret key is not configured (photo routes answer 503). */
  media?: MediaStore;
  /** Monthly AI budget in US dollars (estimated cost). Defaults to 25. */
  aiBudgetUsd?: number;
  practiceInstagram?: boolean;
  livePhotoAdvice?: boolean;
  liveReferenceImages?: boolean;
  evaluationMaxCalls?: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

export function createApp(deps: AppDeps): { app: express.Express; policies: PolicyRouter } {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: deps.webOrigin }));
  // Interview transcripts can be long (up to 150,000 characters); every other request stays small.
  app.use(/^\/api\/interviews\/[^/]+\/transcripts$/, express.json({ limit: '700kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  // Public: liveness only. Reveals nothing about configuration.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Everything under /api requires authentication first, then a per-route capability policy.
  const aiLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, ...deps.rateLimits?.ai });
  const policies = buildRoutes({
    db: deps.db,
    authAdmin: deps.authAdmin,
    ai: deps.ai ?? null,
    aiBudgetUsd: deps.aiBudgetUsd ?? 25,
    practiceInstagram: deps.practiceInstagram,
    livePhotoAdvice: deps.livePhotoAdvice,
    liveReferenceImages: deps.liveReferenceImages,
    evaluationMaxCalls: deps.evaluationMaxCalls,
    aiLimit,
    media: deps.media,
  });
  const perIp = rateLimit({
    windowMs: FIVE_MINUTES,
    max: 300,
    ...deps.rateLimits?.perIp,
    key: (req) => `ip:${req.ip ?? 'unknown'}`,
  });
  const perUser = rateLimit({ windowMs: FIVE_MINUTES, max: 300, ...deps.rateLimits?.perUser });
  // Limit by IP before verifying tokens (cheap protection against floods), then per user.
  app.use('/api', perIp, authenticate(deps.authenticator), perUser, policies.router);

  app.use(notFound);
  app.use(errorHandler);
  return { app, policies };
}
