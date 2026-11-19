import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import {
  INTERVIEW_QUESTIONS,
  type InterviewAnswerView,
  type InterviewExtraction,
  type InterviewProposal,
  type InterviewSessionDetail,
  type InterviewSessionSummary,
} from '@the-pocket/shared';
import { recordAudit } from '../audit.js';
import { callProvider, guard, type AiDeps } from '../ai/assistant.js';
import { brandCoreDocuments } from '../ai/context.js';
import { scrubDocumentKeys } from '../ai/history.js';
import { INTERVIEW_EXTRACT_SYSTEM, INTERVIEW_FOLLOW_UP_SYSTEM } from '../ai/prompts.js';
import { recordUsage } from '../ai/usage.js';
import { createItemTx } from '../knowledge/service.js';
import type { AuthContext } from '../types.js';

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());
const GUIDE = new Map(INTERVIEW_QUESTIONS.map((q) => [q.id, q]));
const baseId = (questionId: string) => questionId.split('.')[0]!;

// ---------------------------------------------------------------------------------------------
// Sessions and answers

interface SessionRow {
  id: string;
  interviewee_name: string;
  interviewee_role: string | null;
  status: 'in_progress' | 'completed';
  ai_consent: boolean;
  conducted_by: string;
  conducted_by_name: string;
  created_at: Date | string;
  completed_at: Date | string | null;
  answered: number;
}

const SESSION_SELECT = `
  SELECT s.id, s.interviewee_name, s.interviewee_role, s.status, s.ai_consent, s.conducted_by, p.name AS conducted_by_name,
         s.created_at, s.completed_at,
         (SELECT count(*)::int FROM (SELECT DISTINCT ON (question_id) answer FROM interview_answers a
            WHERE a.session_id = s.id ORDER BY question_id, seq DESC) x WHERE btrim(x.answer) <> '') AS answered
    FROM interview_sessions s JOIN profiles p ON p.user_id = s.conducted_by`;

const toSummary = (r: SessionRow): InterviewSessionSummary => ({
  id: r.id,
  intervieweeName: r.interviewee_name,
  intervieweeRole: r.interviewee_role,
  status: r.status,
  aiConsent: r.ai_consent,
  conductedBy: { id: r.conducted_by, name: r.conducted_by_name },
  createdAt: iso(r.created_at)!,
  completedAt: iso(r.completed_at),
  answered: r.answered,
});

export async function listInterviews(db: Db, restaurantId: string): Promise<InterviewSessionSummary[]> {
  const rows = await db.query<SessionRow>(`${SESSION_SELECT} WHERE s.restaurant_id = $1 ORDER BY s.created_at DESC`, [restaurantId]);
  return rows.map(toSummary);
}

async function getSession(db: Db, restaurantId: string, sessionId: string): Promise<SessionRow | null> {
  const [row] = await db.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1 AND s.restaurant_id = $2`, [sessionId, restaurantId]);
  return row ?? null;
}

/** The latest answer to each question (an empty answer means it was cleared). */
async function latestAnswers(db: Db, sessionId: string): Promise<InterviewAnswerView[]> {
  const rows = await db.query<{ question_id: string; question_text: string; answer: string; recorded_by: string; name: string; created_at: Date | string }>(
    `SELECT DISTINCT ON (a.question_id) a.question_id, a.question_text, a.answer, a.recorded_by, p.name, a.created_at
       FROM interview_answers a JOIN profiles p ON p.user_id = a.recorded_by
      WHERE a.session_id = $1 ORDER BY a.question_id, a.seq DESC`,
    [sessionId],
  );
  return rows
    .filter((r) => r.answer.trim() !== '')
    .map((r) => ({ questionId: r.question_id, questionText: r.question_text, answer: r.answer, recordedBy: { id: r.recorded_by, name: r.name }, recordedAt: iso(r.created_at)! }));
}

export async function getInterview(db: Db, restaurantId: string, sessionId: string): Promise<InterviewSessionDetail | null> {
  const s = await getSession(db, restaurantId, sessionId);
  if (!s) return null;
  const extractions = await db.query<{ id: string; result: Omit<InterviewExtraction, 'id' | 'createdAt'>; created_at: Date | string }>(
    `SELECT id, result, created_at FROM interview_extractions WHERE session_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [sessionId],
  );
  const saves = await db.query<{ extraction_id: string; proposal_index: number; knowledge_item_id: string; knowledge_version_id: string }>(
    `SELECT extraction_id, proposal_index, knowledge_item_id, knowledge_version_id FROM interview_proposal_saves WHERE extraction_id = ANY($1::uuid[])`,
    [extractions.map((e) => e.id)],
  );
  return {
    ...toSummary(s),
    answers: await latestAnswers(db, sessionId),
    extractions: extractions.map((e) => ({
      ...e.result,
      id: e.id,
      createdAt: iso(e.created_at)!,
      proposals: e.result.proposals.map((p, i) => {
        const saved = saves.find((x) => x.extraction_id === e.id && x.proposal_index === i);
        return { ...p, savedAs: saved ? { itemId: saved.knowledge_item_id, versionId: saved.knowledge_version_id } : null };
      }),
    })),
  };
}

export async function startInterview(
  db: Db,
  actor: AuthContext,
  input: { intervieweeName: string; intervieweeRole?: string; aiConsent: boolean },
  requestId?: string,
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx) => {
    const [s] = await tx.query<{ id: string }>(
      `INSERT INTO interview_sessions (restaurant_id, interviewee_name, interviewee_role, notes_consent, ai_consent, conducted_by)
       VALUES ($1, $2, $3, true, $4, $5) RETURNING id`,
      [actor.restaurantId, input.intervieweeName, input.intervieweeRole ?? null, input.aiConsent, actor.userId],
    );
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'interview.started',
      targetType: 'interview_session',
      targetId: s!.id,
      details: { interviewee: input.intervieweeName, aiConsent: input.aiConsent },
      requestId,
    });
    return { sessionId: s!.id };
  });
}

export type AnswerOutcome = 'saved' | 'not_found' | 'completed' | 'needs_question_text';

export async function saveAnswer(
  db: Db,
  actor: AuthContext,
  sessionId: string,
  input: { questionId: string; questionText?: string; answer: string },
): Promise<AnswerOutcome> {
  const s = await getSession(db, actor.restaurantId, sessionId);
  if (!s) return 'not_found';
  if (s.status === 'completed') return 'completed';
  const isFollowUp = input.questionId.includes('.');
  // Guide questions always use the guide's wording; follow-ups record exactly what was asked.
  const text = isFollowUp ? input.questionText : GUIDE.get(input.questionId)?.question;
  if (!text) return 'needs_question_text';
  await db.query(
    `INSERT INTO interview_answers (session_id, restaurant_id, question_id, question_text, answer, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, actor.restaurantId, input.questionId, text, input.answer, actor.userId],
  );
  return 'saved';
}

export async function completeInterview(db: Db, actor: AuthContext, sessionId: string, requestId?: string): Promise<'completed' | 'not_found' | 'already_completed'> {
  return db.transaction(async (tx) => {
    const [s] = await tx.query<{ status: string }>(`SELECT status FROM interview_sessions WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`, [sessionId, actor.restaurantId]);
    if (!s) return 'not_found' as const;
    if (s.status === 'completed') return 'already_completed' as const;
    await tx.query(`UPDATE interview_sessions SET status = 'completed', completed_at = now(), completed_by = $2 WHERE id = $1`, [sessionId, actor.userId]);
    await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId, action: 'interview.completed', targetType: 'interview_session', targetId: sessionId, requestId });
    return 'completed' as const;
  });
}

export async function withdrawAiConsent(db: Db, actor: AuthContext, sessionId: string, requestId?: string): Promise<'withdrawn' | 'not_found'> {
  return db.transaction(async (tx) => {
    const rows = await tx.query(`UPDATE interview_sessions SET ai_consent = false WHERE id = $1 AND restaurant_id = $2 RETURNING id`, [sessionId, actor.restaurantId]);
    if (rows.length === 0) return 'not_found' as const;
    await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId, action: 'interview.ai_consent_withdrawn', targetType: 'interview_session', targetId: sessionId, requestId });
    return 'withdrawn' as const;
  });
}

// ---------------------------------------------------------------------------------------------
// AI: follow-up questions

const followUpOutput = z.object({ follow_up: z.string() });

export type FollowUpOutcome =
  | { followUp: string; questionId: string; source: 'ai' | 'guide' }
  | 'not_found'
  | 'completed'
  | 'no_answer'
  | 'too_many';

/**
 * Suggests the next follow-up for a guide question. Uses the AI only when the interviewee agreed
 * and an AI provider is configured; otherwise (or for the first follow-up when the AI is off)
 * returns the guide's own follow-up.
 */
export async function suggestFollowUp(deps: AiDeps, actor: AuthContext, sessionId: string, questionId: string): Promise<FollowUpOutcome> {
  const s = await getSession(deps.db, actor.restaurantId, sessionId);
  if (!s) return 'not_found';
  if (s.status === 'completed') return 'completed';
  const base = baseId(questionId);
  const q = GUIDE.get(base)!;
  const answers = (await latestAnswers(deps.db, sessionId)).filter((a) => baseId(a.questionId) === base);
  if (answers.length === 0) return 'no_answer';
  const used = new Set(answers.map((a) => a.questionId));
  const next = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}.f${n}`).find((id) => !used.has(id));
  if (!next) return 'too_many';

  if (!s.ai_consent || !deps.ai) {
    return { followUp: q.followUp ?? 'Can you give an example?', questionId: next, source: 'guide' };
  }
  const ai = await guard(deps, actor, 'interview');
  const transcript = answers.map((a) => `Q: ${a.questionText}\nA: ${a.answer.replace(/[<>]/g, '')}`).join('\n\n');
  const prompt = `<interview_excerpt>\n${transcript}\n</interview_excerpt>\n\nThe interview guide suggests this follow-up, if useful: "${q.followUp ?? ''}"\nSuggest the next follow-up question.`;
  const res = await callProvider(deps, actor, 'interview', ai, () =>
    ai.structured({
      system: INTERVIEW_FOLLOW_UP_SYSTEM,
      documents: [],
      prompt,
      schema: followUpOutput,
      effort: 'low',
      mock: () => ({ follow_up: `[MOCK] ${q.followUp ?? 'Can you give an example?'}` }),
    }),
  );
  await recordUsage(deps.db, {
    restaurantId: actor.restaurantId,
    userId: actor.userId,
    task: 'interview',
    provider: ai.name,
    model: res.model,
    usage: res.usage,
    outcome: res.refused ? 'refused' : res.data ? 'ok' : 'error',
  });
  const text = res.data?.follow_up.trim().slice(0, 500);
  return text ? { followUp: text, questionId: next, source: 'ai' } : { followUp: q.followUp ?? 'Can you give an example?', questionId: next, source: 'guide' };
}

// ---------------------------------------------------------------------------------------------
// AI: proposed brand rules and facts

export const extractionOutput = z.object({
  proposals: z.array(
    z.object({
      kind: z.enum(['brand_rule', 'fact']),
      title: z.string(),
      body: z.string(),
      support: z.array(z.object({ question_id: z.string(), quote: z.string() })),
      conflicts: z.array(z.string()),
      verify_with: z.string(),
    }),
  ),
  open_questions: z.array(z.string()),
});
export type ExtractionOutput = z.infer<typeof extractionOutput>;

/** Lowercased, straight quotes, single spaces, no angle brackets: used only to compare quotes with answers. */
export const normalizeForQuote = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'.,;:!?…\s]+|["'.,;:!?…\s]+$/g, '');

const MAX_PROPOSALS = 25;

/**
 * Keeps only proposals whose quotes really appear in the interviewee's answers. Unsupported quotes
 * are removed; a proposal left with no support is dropped. The model can therefore never attribute
 * words to a manager that they did not say.
 */
export function checkExtraction(out: ExtractionOutput, answers: InterviewAnswerView[], docs: Parameters<typeof scrubDocumentKeys>[1]): Pick<InterviewExtraction, 'proposals' | 'openQuestions' | 'warnings'> {
  const byId = new Map(answers.map((a) => [a.questionId, normalizeForQuote(a.answer)]));
  let droppedQuotes = 0;
  let droppedProposals = 0;
  const proposals: InterviewProposal[] = [];
  for (const p of out.proposals.slice(0, MAX_PROPOSALS)) {
    const support = p.support
      .map((s) => ({ questionId: s.question_id.trim(), quote: s.quote.trim().slice(0, 500) }))
      .filter((s) => {
        const answer = byId.get(s.questionId);
        const quote = normalizeForQuote(s.quote);
        const ok = !!answer && quote.length >= 3 && answer.includes(quote);
        if (!ok) droppedQuotes++;
        return ok;
      });
    if (support.length === 0) {
      droppedProposals++;
      continue;
    }
    const scrub = (s: string) => scrubDocumentKeys(s.trim(), docs);
    proposals.push({
      kind: p.kind,
      title: scrub(p.title).slice(0, 200) || 'Untitled',
      body: scrub(p.body).slice(0, 4000),
      support,
      conflicts: p.conflicts.map(scrub).filter(Boolean).slice(0, 10),
      verifyWith: scrub(p.verify_with).slice(0, 300),
      savedAs: null,
    });
  }
  const warnings: string[] = [];
  if (droppedQuotes) warnings.push(`${droppedQuotes} quote${droppedQuotes === 1 ? '' : 's'} did not match the recorded answers word for word and ${droppedQuotes === 1 ? 'was' : 'were'} removed.`);
  if (droppedProposals) warnings.push(`${droppedProposals} suggestion${droppedProposals === 1 ? '' : 's'} had no supporting quote from this interview and ${droppedProposals === 1 ? 'was' : 'were'} left out.`);
  if (out.proposals.length > MAX_PROPOSALS) warnings.push(`Only the first ${MAX_PROPOSALS} suggestions are shown.`);
  return { proposals, openQuestions: out.open_questions.map((q) => scrubDocumentKeys(q.trim(), docs)).filter(Boolean).slice(0, 15), warnings };
}

export type ExtractOutcome = InterviewExtraction | 'not_found' | 'no_consent' | 'no_answers';

export async function extractProposals(deps: AiDeps, actor: AuthContext, sessionId: string, requestId?: string): Promise<ExtractOutcome> {
  const { db } = deps;
  const s = await getSession(db, actor.restaurantId, sessionId);
  if (!s) return 'not_found';
  if (!s.ai_consent) return 'no_consent';
  const answers = await latestAnswers(db, sessionId);
  if (answers.length === 0) return 'no_answers';
  const ai = await guard(deps, actor, 'extract');

  const docs = await brandCoreDocuments(db, actor.restaurantId);
  const who = `${s.interviewee_name}${s.interviewee_role ? ` (${s.interviewee_role})` : ''}`.replace(/[<>"]/g, '');
  const mine = answers.map((a) => `[${a.questionId}] Q: ${a.questionText}\nA: ${a.answer.replace(/[<>]/g, '')}`).join('\n\n');

  // Other managers' answers to the same questions (only from interviews that allow AI use).
  const others = await db.query<{ name: string; question_id: string; answer: string }>(
    `SELECT s.interviewee_name AS name, a.question_id, a.answer FROM (
       SELECT DISTINCT ON (session_id, question_id) session_id, question_id, answer FROM interview_answers
        WHERE restaurant_id = $1 AND session_id <> $2 ORDER BY session_id, question_id, seq DESC) a
       JOIN interview_sessions s ON s.id = a.session_id AND s.ai_consent
      WHERE btrim(a.answer) <> '' AND a.question_id = ANY($3::text[])
      ORDER BY a.question_id, s.interviewee_name`,
    [actor.restaurantId, sessionId, answers.map((a) => a.questionId)],
  );
  let otherText = '';
  for (const o of others) {
    const line = `[${o.question_id}] ${o.name.replace(/[<>"]/g, '')}: ${o.answer.replace(/[<>]/g, '').replace(/\s+/g, ' ').slice(0, 600)}\n`;
    if (otherText.length + line.length > 12000) break;
    otherText += line;
  }

  const prompt = [
    `<interview_answers interviewee="${who}">`,
    mine,
    '</interview_answers>',
    otherText ? `<other_interviews>\n${otherText}</other_interviews>` : 'There are no other interviews to compare with yet.',
    '',
    'Write the proposed brand rules and facts now.',
  ].join('\n');

  const res = await callProvider(deps, actor, 'extract', ai, () =>
    ai.structured({
      system: INTERVIEW_EXTRACT_SYSTEM,
      documents: docs,
      prompt,
      schema: extractionOutput,
      effort: 'high',
      mock: () => mockExtraction(answers),
    }),
  );
  await recordUsage(db, {
    restaurantId: actor.restaurantId,
    userId: actor.userId,
    task: 'extract',
    provider: ai.name,
    model: res.model,
    usage: res.usage,
    outcome: res.refused ? 'refused' : res.data ? 'ok' : 'error',
  });
  const checked = res.data
    ? checkExtraction(res.data, answers, docs)
    : { proposals: [], openQuestions: [], warnings: [res.refused ? "The assistant can't help with that request." : 'The assistant returned an unreadable result. Please try again.'] };
  const result = { ...checked, provider: ai.name };

  const [row] = await db.query<{ id: string; created_at: Date | string }>(
    `INSERT INTO interview_extractions (session_id, restaurant_id, result, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING id, created_at`,
    [sessionId, actor.restaurantId, JSON.stringify(result), actor.userId],
  );
  await recordAudit(db, {
    restaurantId: actor.restaurantId,
    actorUserId: actor.userId,
    action: 'interview.rules_drafted',
    targetType: 'interview_session',
    targetId: sessionId,
    details: { extractionId: row!.id, proposals: result.proposals.length, provider: ai.name },
    requestId,
  });
  return { ...result, id: row!.id, createdAt: iso(row!.created_at)! };
}

function mockExtraction(answers: InterviewAnswerView[]): ExtractionOutput {
  const a = answers[0]!;
  return {
    proposals: [
      {
        kind: 'brand_rule',
        title: `[MOCK] From ${a.questionId}`,
        body: `[MOCK - no AI was called] A proposed rule based on the answer to ${a.questionId}.`,
        support: [{ question_id: a.questionId, quote: a.answer.split(/\s+/).slice(0, 6).join(' ') }],
        conflicts: [],
        verify_with: '',
      },
    ],
    open_questions: ['[MOCK] Placeholder open question.'],
  };
}

// ---------------------------------------------------------------------------------------------
// Saving a suggestion to the knowledge library (always as a proposal)

export type SaveProposalOutcome = { itemId: string; versionId: string } | 'not_found' | 'already_saved';

export async function saveProposal(
  db: Db,
  actor: AuthContext,
  sessionId: string,
  input: { extractionId: string; index: number; kind: 'brand_rule' | 'fact'; title: string; body: string },
  requestId?: string,
): Promise<SaveProposalOutcome> {
  return db.transaction(async (tx) => {
    const [ex] = await tx.query<{ result: { proposals: InterviewProposal[] }; name: string; role: string | null; created_at: Date | string }>(
      `SELECT e.result, s.interviewee_name AS name, s.interviewee_role AS role, s.created_at
         FROM interview_extractions e JOIN interview_sessions s ON s.id = e.session_id
        WHERE e.id = $1 AND e.session_id = $2 AND e.restaurant_id = $3 FOR UPDATE OF e`,
      [input.extractionId, sessionId, actor.restaurantId],
    );
    const proposal = ex?.result.proposals[input.index];
    if (!ex || !proposal) return 'not_found' as const;
    if ((await tx.query(`SELECT 1 FROM interview_proposal_saves WHERE extraction_id = $1 AND proposal_index = $2`, [input.extractionId, input.index])).length) {
      return 'already_saved' as const;
    }
    // The source note is built from the stored, verified quotes, never from the request.
    const date = new Date(ex.created_at).toISOString().slice(0, 10);
    const quotes = proposal.support.map((s) => `${s.questionId}: “${s.quote}”`).join('; ');
    const sourceNote = `Brand interview with ${ex.name}${ex.role ? ` (${ex.role})` : ''}, ${date}. ${quotes}`.slice(0, 500);
    const created = await createItemTx(tx, actor, { kind: input.kind, title: input.title, body: input.body, sourceNote, origin: 'interview' }, requestId);
    await tx.query(
      `INSERT INTO interview_proposal_saves (extraction_id, proposal_index, knowledge_item_id, knowledge_version_id, saved_by) VALUES ($1, $2, $3, $4, $5)`,
      [input.extractionId, input.index, created.itemId, created.versionId, actor.userId],
    );
    return created;
  });
}
