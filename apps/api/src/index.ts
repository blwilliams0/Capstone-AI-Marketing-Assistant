import { createPgDb, type Db } from '@the-pocket/db';
import { createApp } from './app.js';
import { createSupabaseAuthAdmin } from './auth/auth-admin.js';
import { createMockAuthenticator, createSupabaseAuthenticator } from './auth/authenticator.js';
import { createSupabaseVerifier } from './auth/tokens.js';
import { loadConfig } from './config.js';
import { createClaudeAiProvider, createClaudeClient } from './ai/claude.js';
import { createMockAiProvider } from './ai/provider.js';
import { createLocalMediaStore } from './media/local.js';
import { createSupabaseMediaStore, ensureMediaBucket } from './media/store.js';

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
    ? createClaudeAiProvider(createClaudeClient(config.anthropicApiKey!, config.evaluationMaxCalls !== undefined), config.evaluationMaxCalls !== undefined)
    : config.aiMode === 'mock'
      ? createMockAiProvider()
      : null;

const practiceMediaDirectory = config.authMode === 'mock' ? process.env.POCKET_PREVIEW_MEDIA_DIR : undefined;
const media =
  practiceMediaDirectory ? createLocalMediaStore(practiceMediaDirectory) : config.supabaseUrl && config.supabaseSecretKey
    ? createSupabaseMediaStore({ supabaseUrl: config.supabaseUrl, secretKey: config.supabaseSecretKey })
    : undefined;

// Make sure the photo bucket exists and is private (photos must never be public). Never fatal.
if (config.supabaseUrl && config.supabaseSecretKey) {
  ensureMediaBucket({ supabaseUrl: config.supabaseUrl, secretKey: config.supabaseSecretKey })
    .then((outcome) => console.log(JSON.stringify({ level: 'info', msg: 'photo storage checked', outcome })))
    .catch((err: unknown) => console.error(JSON.stringify({ level: 'error', msg: 'photo storage check failed', error: err instanceof Error ? err.message : String(err) })));
}

const { app } = createApp({ db, authenticator, authAdmin, webOrigin: config.webOrigin, ai, aiBudgetUsd: config.aiMonthlyBudgetUsd, practiceInstagram: config.authMode === 'mock', livePhotoAdvice: config.livePhotoAdvice, liveReferenceImages: config.liveReferenceImages, evaluationMaxCalls: config.evaluationMaxCalls, media });

const hostname = config.authMode === 'mock' ? '127.0.0.1' : '0.0.0.0';
const server = app.listen(config.port, hostname, () => {
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
