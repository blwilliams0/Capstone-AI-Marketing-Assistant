import { createPgDb } from '@the-pocket/db';
import { askSchema, capabilitiesFor, isRole } from '@the-pocket/shared';
import { loadConfig } from '../config.js';
import { createClaudeAiProvider, createClaudeClient } from '../ai/claude.js';
import { ask } from '../ai/assistant.js';

/**
 * One real Claude question as the first active admin, through the same code the app uses.
 * Costs a few cents. Prints the answer, sources and token usage; never prints keys.
 *
 *   npm run ai-live-check -w @the-pocket/api -- "your question"
 */
const config = loadConfig();
if (config.aiMode !== 'claude' || !config.databaseUrl) {
  console.error('Needs ANTHROPIC_API_KEY and DATABASE_URL in .env.local.');
  process.exit(1);
}
const question = askSchema.parse({ question: process.argv[2] ?? 'What tone should our Instagram captions use, and what should we avoid?' }).question;
const db = createPgDb(config.databaseUrl);
try {
  const [m] = await db.query<{ user_id: string; email: string; name: string; restaurant_id: string; id: string; role: string }>(
    `SELECT m.user_id, p.email, p.name, m.restaurant_id, m.id, m.role FROM memberships m
     JOIN profiles p ON p.user_id = m.user_id WHERE m.role = 'admin' AND m.status = 'active' ORDER BY m.created_at LIMIT 1`,
  );
  if (!m || !isRole(m.role)) throw new Error('No active admin found.');
  const actor = {
    userId: m.user_id,
    email: m.email,
    name: m.name,
    restaurantId: m.restaurant_id,
    membershipId: m.id,
    role: m.role,
    capabilities: capabilitiesFor(m.role),
  };
  const ai = createClaudeAiProvider(createClaudeClient(config.anthropicApiKey!));
  const started = Date.now();
  const res = await ask({ db, ai, budgetUsd: config.aiMonthlyBudgetUsd }, actor, { question });
  if (res === 'not_found') throw new Error('conversation not found');
  const [u] = await db.query<Record<string, unknown>>(
    `SELECT model, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
     FROM ai_usage_events WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [actor.restaurantId],
  );
  console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, question, ...res, usage: u }, null, 2));
} finally {
  await db.close();
}
