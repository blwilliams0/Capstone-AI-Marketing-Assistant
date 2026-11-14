import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Db } from '@the-pocket/db';
import type { Authenticator } from './auth/authenticator.js';
import type { AuthAdmin } from './auth/auth-admin.js';
import { authenticate, errorHandler, notFound, requestId, requestLogger } from './middleware.js';
import { buildRoutes } from './routes.js';
import type { PolicyRouter } from './policy.js';

export interface AppDeps {
  db: Db;
  authenticator: Authenticator;
  authAdmin?: AuthAdmin;
  webOrigin: string;
}

export function createApp(deps: AppDeps): { app: express.Express; policies: PolicyRouter } {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: deps.webOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  // Public: liveness only. Reveals nothing about configuration.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Everything under /api requires authentication first, then a per-route capability policy.
  const policies = buildRoutes({ db: deps.db, authAdmin: deps.authAdmin });
  app.use('/api', authenticate(deps.authenticator), policies.router);

  app.use(notFound);
  app.use(errorHandler);
  return { app, policies };
}
