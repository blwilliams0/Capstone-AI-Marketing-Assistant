import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import {
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  type AskResponse,
  type DraftRequest,
  type DraftResponse,
  type SourceRef,
} from '@the-pocket/shared';
import type { AuthContext } from '../types.js';
import { buildContext } from './context.js';
import { ANSWER_SYSTEM, DRAFT_SYSTEM } from './prompts.js';
import type { AiDocument, AiProvider } from './provider.js';
import { monthToDateCostUsd, recordUsage, type AiTask } from './usage.js';

export interface AiDeps {
  db: Db;
  /** null when no AI is configured (production without an API key): AI routes answer 503. */
  ai: AiProvider | null;
  budgetUsd: number;
}

export class AiUnavailableError extends Error {
  constructor(public readonly reason: 'disabled' | 'budget' | 'provider_error') {
    super(reason);
  }
}

const consultedOf = (docs: AiDocument[]) => docs.map((d) => ({ title: d.title, kind: d.kind, core: d.core }));

/** Fails closed: no provider, or this month's estimated spend has reached the budget. */
async function guard(deps: AiDeps, actor: AuthContext, task: AiTask): Promise<AiProvider> {
  if (!deps.ai) throw new AiUnavailableError('disabled');
  if ((await monthToDateCostUsd(deps.db, actor.restaurantId)) >= deps.budgetUsd) {
    await recordUsage(deps.db, {
      restaurantId: actor.restaurantId,
      userId: actor.userId,
      task,
      provider: deps.ai.name,
      model: 'none',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outcome: 'blocked_budget',
    });
    throw new AiUnavailableError('budget');
  }
  return deps.ai;
}

async function callProvider<T>(deps: AiDeps, actor: AuthContext, task: AiTask, ai: AiProvider, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await recordUsage(deps.db, {
      restaurantId: actor.restaurantId,
      userId: actor.userId,
      task,
      provider: ai.name,
      model: 'unknown',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outcome: 'error',
    });
    console.error(JSON.stringify({ level: 'error', msg: 'ai provider error', task, error: err instanceof Error ? err.message : String(err) }));
    throw new AiUnavailableError('provider_error');
  }
}

export async function ask(
  deps: AiDeps,
  actor: AuthContext,
  input: { question: string; conversationId?: string },
): Promise<AskResponse | 'not_found'> {
  const { db } = deps;
  let history: { question: string; answer: string }[] = [];
  if (input.conversationId) {
    const [conv] = await db.query(`SELECT 1 FROM conversations WHERE id = $1 AND restaurant_id = $2 AND user_id = $3`, [
      input.conversationId,
      actor.restaurantId,
      actor.userId,
    ]);
    if (!conv) return 'not_found';
    const msgs = await db.query<{ role: string; content: string }>(
      `SELECT role, content FROM conversation_messages WHERE conversation_id = $1 ORDER BY seq DESC LIMIT 6`,
      [input.conversationId],
    );
    const ordered = msgs.reverse();
    for (let i = 0; i + 1 < ordered.length; i++) {
      if (ordered[i]!.role === 'user' && ordered[i + 1]!.role === 'assistant') {
        history.push({ question: ordered[i]!.content, answer: ordered[i + 1]!.content });
        i++;
      }
    }
    history = history.slice(-3);
  }

  const ai = await guard(deps, actor, 'answer');
  const docs = await buildContext(db, actor.restaurantId, input.question);
  const res = await callProvider(deps, actor, 'answer', ai, () =>
    ai.answer({ system: ANSWER_SYSTEM, documents: docs, question: input.question, history, effort: 'medium' }),
  );

  const byKey = new Map(docs.map((d) => [d.key, d]));
  const sources = new Map<string, SourceRef>();
  for (const c of res.citations) {
    const d = byKey.get(c.documentKey);
    if (!d) continue;
    const s = sources.get(d.versionId) ?? { versionId: d.versionId, title: d.title, kind: d.kind, quotes: [] };
    if (s.quotes.length < 2 && c.citedText.trim()) s.quotes.push(c.citedText.trim().slice(0, 300));
    sources.set(d.versionId, s);
  }
  const answer = res.refused ? "The assistant can't help with that request. Try rephrasing it as a marketing question." : res.text || '(No answer was returned.)';

  const conversationId = await db.transaction(async (tx) => {
    let id = input.conversationId;
    if (!id) {
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO conversations (restaurant_id, user_id, title) VALUES ($1, $2, $3) RETURNING id`,
        [actor.restaurantId, actor.userId, input.question.slice(0, 80)],
      );
      id = c!.id;
    }
    await tx.query(`INSERT INTO conversation_messages (conversation_id, restaurant_id, role, content) VALUES ($1, $2, 'user', $3)`, [
      id,
      actor.restaurantId,
      input.question,
    ]);
    await tx.query(
      `INSERT INTO conversation_messages (conversation_id, restaurant_id, role, content, sources) VALUES ($1, $2, 'assistant', $3, $4::jsonb)`,
      [id, actor.restaurantId, answer, JSON.stringify([...sources.values()])],
    );
    return id;
  });

  await recordUsage(db, {
    restaurantId: actor.restaurantId,
    userId: actor.userId,
    task: 'answer',
    provider: ai.name,
    model: res.model,
    usage: res.usage,
    outcome: res.refused ? 'refused' : 'ok',
  });

  return { conversationId, answer, sources: [...sources.values()], consulted: consultedOf(docs), refused: res.refused, provider: ai.name };
}

/** What the model must return for a draft. Kept free of length limits (checked after parsing). */
export const draftOutputSchema = z.object({
  options: z.array(
    z.object({
      caption: z.string(),
      angle: z.string(),
      why_it_fits: z.string(),
      uses_documents: z.array(z.string()),
    }),
  ),
  what_to_confirm: z.array(z.string()),
  risks: z.array(z.string()),
  suggested_timing: z.string(),
  how_to_measure: z.array(z.string()),
  photo_tips: z.array(z.string()),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

const CAPTION_LIMIT = 2200;

/**
 * Validates AI draft output against what the server actually supplied. References to unknown
 * documents are removed and reported, so a draft can never claim support from a source that the
 * model was not given.
 */
export function checkDraft(out: DraftOutput, docs: AiDocument[]): Pick<DraftResponse, 'options' | 'warnings'> {
  const byKey = new Map(docs.map((d) => [d.key, d]));
  const warnings: string[] = [];
  const options = out.options.slice(0, 3).map((o, i) => {
    const unknown = o.uses_documents.filter((k) => !byKey.has(k));
    if (unknown.length) warnings.push(`Option ${i + 1} referred to sources that were not provided (${unknown.join(', ')}); those references were removed.`);
    if (o.caption.length > CAPTION_LIMIT) warnings.push(`Option ${i + 1} is longer than ${CAPTION_LIMIT} characters and will need shortening.`);
    const seen = new Set<string>();
    const sources = o.uses_documents
      .map((k) => byKey.get(k))
      .filter((d): d is AiDocument => !!d && !seen.has(d.versionId) && !!seen.add(d.versionId))
      .map((d) => ({ versionId: d.versionId, title: d.title, kind: d.kind }));
    return { caption: o.caption.trim(), angle: o.angle.trim(), whyItFits: o.why_it_fits.trim(), sources };
  });
  if (options.length === 0) warnings.push('The assistant returned no options. Try again with a more specific topic.');
  return { options, warnings };
}

function mockDraft(docs: AiDocument[], req: DraftRequest): DraftOutput {
  const key = docs[0]?.key;
  return {
    options: [1, 2].map((n) => ({
      caption: `[MOCK DRAFT ${n} - no AI was called] ${req.topic} for ${req.audience} on ${req.channel}.`,
      angle: n === 1 ? 'Seasonal discovery' : 'Personal hospitality',
      why_it_fits: 'Placeholder text from the mock provider.',
      uses_documents: key ? [key] : [],
    })),
    what_to_confirm: ['Confirm the dish and date with the kitchen.'],
    risks: [],
    suggested_timing: 'Placeholder timing.',
    how_to_measure: ['Placeholder measure.'],
    photo_tips: ['Placeholder photo tip.'],
  };
}

export async function draft(deps: AiDeps, actor: AuthContext, req: DraftRequest): Promise<DraftResponse> {
  const ai = await guard(deps, actor, 'draft');
  const docs = await buildContext(deps.db, actor.restaurantId, `${req.topic} ${req.goal}`);
  const prompt = [
    `Audience: ${AUDIENCE_LABELS[req.audience]}`,
    `Channel: ${CHANNEL_LABELS[req.channel]}`,
    `Goal: ${req.goal}`,
    `What the post is about: ${req.topic}`,
    '',
    'Write the draft options now.',
  ].join('\n');

  const res = await callProvider(deps, actor, 'draft', ai, () =>
    ai.structured({ system: DRAFT_SYSTEM, documents: docs, prompt, schema: draftOutputSchema, effort: 'medium', mock: () => mockDraft(docs, req) }),
  );
  await recordUsage(deps.db, {
    restaurantId: actor.restaurantId,
    userId: actor.userId,
    task: 'draft',
    provider: ai.name,
    model: res.model,
    usage: res.usage,
    outcome: res.refused ? 'refused' : res.data ? 'ok' : 'error',
  });

  const base = { consulted: consultedOf(docs), refused: res.refused, provider: ai.name };
  if (!res.data) {
    return {
      ...base,
      options: [],
      whatToConfirm: [],
      risks: [],
      suggestedTiming: '',
      howToMeasure: [],
      photoTips: [],
      warnings: [res.refused ? "The assistant can't help with that request." : 'The assistant returned an unreadable draft. Please try again.'],
    };
  }
  const checked = checkDraft(res.data, docs);
  const warnings = [...checked.warnings];
  if (!docs.some((d) => d.kind === 'brand_rule')) {
    warnings.unshift('No approved brand rules yet, so these drafts are not grounded in management-approved guidance. Approve brand rules first.');
  }
  return {
    ...base,
    options: checked.options,
    whatToConfirm: res.data.what_to_confirm,
    risks: res.data.risks,
    suggestedTiming: res.data.suggested_timing,
    howToMeasure: res.data.how_to_measure,
    photoTips: res.data.photo_tips,
    warnings,
  };
}
