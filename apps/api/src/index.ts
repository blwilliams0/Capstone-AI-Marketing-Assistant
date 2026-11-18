import { createPgDb, type Db } from '@the-pocket/db';
import { createApp } from './app.js';
import { createSupabaseAuthAdmin } from './auth/auth-admin.js';
import { createMockAuthenticator, createSupabaseAuthenticator } from './auth/authenticator.js';
import { createSupabaseVerifier } from './auth/tokens.js';
import { loadConfig } from './config.js';
import { createClaudeAiProvider, createClaudeClient } from './ai/claude.js';
import { createMockAiProvider } from './ai/provider.js';

const config = loadConfig(); // throws (and the process exits) on unsafe or incomplete configuration

const unavailableDb: Db = {
  async query() {
    throw new Error('No DATABASE_URL configured (mock mode without a database).');
  },
  async exec() {
    throw new Error('No DATABASE_URL configured (mock mode without a database).');
  },
  async transaction() {
    throw new Error('No DATABASE_URL configured (mock mode without a database).');
  },
  async close() {},
};
const db = config.databaseUrl ? createPgDb(config.databaseUrl) : unavailableDb;

const authenticator =
  config.authMode === 'mock'
    ? createMockAuthenticator()
    : createSupabaseAuthenticator(createSupabaseVerifier(config.supabaseUrl!), db);

const authAdmin =
  config.supabaseUrl && config.supabaseSecretKey
    ? createSupabaseAuthAdmin({
        supabaseUrl: config.supabaseUrl,
        secretKey: config.supabaseSecretKey,
        redirectTo: config.webOrigin,
      })
    : undefined;

const ai =
  config.aiMode === 'claude'
    ? createClaudeAiProvider(createClaudeClient(config.anthropicApiKey!))
    : config.aiMode === 'mock'
      ? createMockAiProvider()
      : null;

const { app } = createApp({ db, authenticator, authAdmin, webOrigin: config.webOrigin, ai, aiBudgetUsd: config.aiMonthlyBudgetUsd });

const server = app.listen(config.port, () => {
  console.log(
    JSON.stringify({ level: 'info', msg: 'api started', port: config.port, authMode: config.authMode, aiMode: config.aiMode }),
  );
  if (config.authMode === 'mock') {
    console.warn('WARNING: AUTH_MODE=mock is active. Anyone can sign in as any role. Local development only.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  });
}
