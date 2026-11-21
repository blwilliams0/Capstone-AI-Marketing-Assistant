import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import {
  INTERVIEW_QUESTIONS,
  type InterviewAnswerView,
  type InterviewExtraction,
  type InterviewProposal,
  type InterviewSessionDetail,
  type InterviewSessionSummary,
  type TranscriptFillResult,
} from '@the-pocket/shared';
import { recordAudit } from '../audit.js';
import { callProvider, guard, type AiDeps } from '../ai/assistant.js';
import { brandCoreDocuments } from '../ai/context.js';
import { scrubDocumentKeys } from '../ai/history.js';
import { INTERVIEW_EXTRACT_SYSTEM, INTERVIEW_FOLLOW_UP_SYSTEM, INTERVIEW_TRANSCRIPT_SYSTEM } from '../ai/prompts.js';
import { recordUsage } from '../ai/usage.js';
import { createItemTx } from '../knowledge/service.js';
import type { AuthContext } from '../types.js';

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

/** Untrusted short text placed in a prompt: no tags, quotes or line breaks, so it cannot forge structure. */
const oneLine = (s: string) => s.replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim();

/** A supporting quote must say something: at least 3 words or 12 characters. */
const isSubstantial = (normalizedQuote: string) => normalizedQuote.split(' ').length >= 3 || normalizedQuote.length >= 12;
const GUIDE = new Map(INTERVIEW_QUESTIONS.map((q) => [q.id, q]));
const baseId = (questionId: string) => questionId.split('.')[0]!;

// ---------------------------------------------------------------------------------------------
// Sessions and answers

interface SessionRow {
  id: string;
  label: string | null;
  is_practice: boolean;
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
  SELECT s.id, s.label, s.is_practice, s.interviewee_name, s.interviewee_role, s.status, s.ai_consent, s.conducted_by, p.name AS conducted_by_name,
         s.created_at, s.completed_at,
         (SELECT count(*)::int FROM (SELECT DISTINCT ON (question_id) answer FROM interview_answers a
            WHERE a.session_id = s.id ORDER BY question_id, seq DESC) x WHERE btrim(x.answer) <> '') AS answered
    FROM interview_sessions s JOIN profiles p ON p.user_id = s.conducted_by`;

const toSummary = (r: SessionRow): InterviewSessionSummary => ({
  id: r.id,
  label: r.label,
  isPractice: r.is_practice,
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
  const rows = await db.query<{ question_id: string; question_text: string; answer: string; recorded_by: string; name: string; created_at: Date | string; source: 'typed' | 'transcript' }>(
    `SELECT DISTINCT ON (a.question_id) a.question_id, a.question_text, a.answer, a.recorded_by, p.name, a.created_at, a.source
       FROM interview_answers a JOIN profiles p ON p.user_id = a.recorded_by
      WHERE a.session_id = $1 ORDER BY a.question_id, a.seq DESC`,
    [sessionId],
  );
  return rows
    .filter((r) => r.answer.trim() !== '')
    .map((r) => ({ questionId: r.question_id, questionText: r.question_text, answer: r.answer, recordedBy: { id: r.recorded_by, name: r.name }, recordedAt: iso(r.created_at)!, source: r.source }));
}

export async function getInterview(db: Db, restaurantId: string, sessionId: string): Promise<InterviewSessionDetail | null> {
  const s = await getSession(db, restaurantId, sessionId);
  if (!s) return null;
  const extractions = await db.query<{ id: string; result: Omit<InterviewExtraction, 'id' | 'createdAt'>; created_at: Date | string }>(
    `SELECT id, result, created_at FROM interview_extractions WHERE session_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [sessionId],
  );
  // What was actually saved (the reviewer may have edited the suggestion first).
  const saves = await db.query<{ extraction_id: string; proposal_index: number; knowledge_item_id: string; knowledge_version_id: string; kind: 'brand_rule' | 'fact'; title: string; body: string }>(
    `SELECT ps.extraction_id, ps.proposal_index, ps.knowledge_item_id, ps.knowledge_version_id, ki.kind, ki.title, kv.body
       FROM interview_proposal_saves ps
       JOIN knowledge_items ki ON ki.id = ps.knowledge_item_id
       JOIN knowledge_versions kv ON kv.id = ps.knowledge_version_id
      WHERE ps.extraction_id = ANY($1::uuid[])`,
    [extractions.map((e) => e.id)],
  );
  return {
    ...toSummary(s),
    answers: await latestAnswers(db, sessionId),
    transcripts: (
      await db.query<{ id: string; file_name: string | null; characters: number; uploaded_by: string; name: string; created_at: Date | string }>(
        `SELECT t.id, t.file_name, char_length(t.body) AS characters, t.uploaded_by, p.name, t.created_at
           FROM interview_transcripts t JOIN profiles p ON p.user_id = t.uploaded_by
          WHERE t.session_id = $1 ORDER BY t.created_at DESC`,
        [sessionId],
      )
    ).map((t) => ({ id: t.id, fileName: t.file_name, characters: t.characters, uploadedBy: { id: t.uploaded_by, name: t.name }, uploadedAt: iso(t.created_at)! })),
    extractions: extractions.map((e) => ({
      ...e.result,
      id: e.id,
      createdAt: iso(e.created_at)!,
      proposals: e.result.proposals.map((p, i) => {
        const saved = saves.find((x) => x.extraction_id === e.id && x.proposal_index === i);
        return {
          ...p,
          savedAs: saved ? { itemId: saved.knowledge_item_id, versionId: saved.knowledge_version_id, kind: saved.kind, title: saved.title, body: saved.body } : null,
        };
      }),
    })),
  };
}

export async function startInterview(
  db: Db,
  actor: AuthContext,
  input: { label?: string; isPractice?: boolean; intervieweeName: string; intervieweeRole?: string; aiConsent: boolean },
  requestId?: string,
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx) => {
    const [s] = await tx.query<{ id: string }>(
      `INSERT INTO interview_sessions (restaurant_id, interviewee_name, interviewee_role, notes_consent, ai_consent, conducted_by, label, is_practice)
       VALUES ($1, $2, $3, true, $4, $5, $6, $7) RETURNING id`,
      [actor.restaurantId, input.intervieweeName, input.intervieweeRole ?? null, input.aiConsent, actor.userId, input.label || null, input.isPractice ?? false],
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
    // The guide has one follow-up per question; after that, ask for an example instead of repeating it.
    const guideText = next === `${base}.f1` && q.followUp ? q.followUp : 'Can you give a concrete example?';
    return { followUp: guideText, questionId: next, source: 'guide' };
  }
  const ai = await guard(deps, actor, 'interview');
  const transcript = answers.map((a) => `Q: ${oneLine(a.questionText)}\nA: ${a.answer.replace(/[<>]/g, '')}`).join('\n\n');
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

/** True when a quote appears (after normalising) in that interviewee's current answer to the cited question. */
function quoteMatcher(answers: InterviewAnswerView[]) {
  const byId = new Map(answers.map((a) => [a.questionId, normalizeForQuote(a.answer)]));
  return (s: { questionId: string; quote: string }) => {
    const answer = byId.get(s.questionId);
    const quote = normalizeForQuote(s.quote);
    return !!answer && isSubstantial(quote) && answer.includes(quote);
  };
}

/**
 * Keeps only proposals whose quotes really appear in the interviewee's answers. Unsupported quotes
 * are removed; a proposal left with no support is dropped. The model can therefore never attribute
 * words to a manager that they did not say.
 */
export function checkExtraction(out: ExtractionOutput, answers: InterviewAnswerView[], docs: Parameters<typeof scrubDocumentKeys>[1]): Pick<InterviewExtraction, 'proposals' | 'openQuestions' | 'warnings'> {
  const matches = quoteMatcher(answers);
  let droppedQuotes = 0;
  let droppedProposals = 0;
  const proposals: InterviewProposal[] = [];
  for (const p of out.proposals.slice(0, MAX_PROPOSALS)) {
    const support = p.support
      .map((s) => ({ questionId: s.question_id.trim(), quote: s.quote.trim().slice(0, 300) }))
      .filter((s) => {
        const ok = matches(s);
        if (!ok) droppedQuotes++;
        return ok;
      })
      .slice(0, 5);
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
  const who = oneLine(`${s.interviewee_name}${s.interviewee_role ? ` (${s.interviewee_role})` : ''}`);
  const mine = answers.map((a) => `[${a.questionId}] Q: ${oneLine(a.questionText)}\nA: ${a.answer.replace(/[<>]/g, '')}`).join('\n\n');

  // Other managers' answers to the same questions (only from interviews that allow AI use).
  const others = await db.query<{ name: string; question_id: string; answer: string }>(
    `SELECT s.interviewee_name AS name, a.question_id, a.answer FROM (
       SELECT DISTINCT ON (session_id, question_id) session_id, question_id, answer FROM interview_answers
        WHERE restaurant_id = $1 AND session_id <> $2 ORDER BY session_id, question_id, seq DESC) a
       JOIN interview_sessions s ON s.id = a.session_id AND s.ai_consent AND NOT s.is_practice
      WHERE btrim(a.answer) <> '' AND a.question_id = ANY($3::text[])
      ORDER BY a.question_id, s.interviewee_name`,
    [actor.restaurantId, sessionId, answers.map((a) => a.questionId)],
  );
  let otherText = '';
  for (const o of others) {
    const line = `[${o.question_id}] ${oneLine(o.name)}: ${o.answer.replace(/[<>]/g, '').replace(/\s+/g, ' ').slice(0, 600)}\n`;
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
      maxTokens: 16000,
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
    : {
        proposals: [],
        openQuestions: [],
        warnings: [
          res.refused
            ? "The assistant can't help with that request."
            : res.truncated
              ? 'The answer was cut off because there was a lot to cover. Try once more; if it happens again, draft the rules by hand in Knowledge for now.'
              : 'The assistant returned an unreadable result. Please try again.',
        ],
      };
  const result = { ...checked, provider: ai.name };

  let row: { id: string; created_at: Date | string } | undefined;
  try {
    [row] = await db.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO interview_extractions (session_id, restaurant_id, result, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING id, created_at`,
      [sessionId, actor.restaurantId, JSON.stringify(result), actor.userId],
    );
  } catch (err) {
    // Consent was withdrawn while the AI was working: keep nothing.
    if (err instanceof Error && /did not agree to AI processing/.test(err.message)) return 'no_consent';
    throw err;
  }
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

export type SaveProposalOutcome = { itemId: string; versionId: string } | 'not_found' | 'already_saved' | 'no_consent' | 'quotes_changed';

export async function saveProposal(
  db: Db,
  actor: AuthContext,
  sessionId: string,
  input: { extractionId: string; index: number; kind: 'brand_rule' | 'fact'; title: string; body: string },
  requestId?: string,
): Promise<SaveProposalOutcome> {
  return db.transaction(async (tx) => {
    const [ex] = await tx.query<{ result: { proposals: InterviewProposal[] }; name: string; role: string | null; created_at: Date | string; ai_consent: boolean }>(
      `SELECT e.result, s.interviewee_name AS name, s.interviewee_role AS role, s.created_at, s.ai_consent
         FROM interview_extractions e JOIN interview_sessions s ON s.id = e.session_id
        WHERE e.id = $1 AND e.session_id = $2 AND e.restaurant_id = $3 FOR UPDATE OF e, s`,
      [input.extractionId, sessionId, actor.restaurantId],
    );
    const proposal = ex?.result.proposals[input.index];
    if (!ex || !proposal) return 'not_found' as const;
    if ((await tx.query(`SELECT 1 FROM interview_proposal_saves WHERE extraction_id = $1 AND proposal_index = $2`, [input.extractionId, input.index])).length) {
      return 'already_saved' as const;
    }
    // Saved rules (with their quotes) are later sent to the AI as brand knowledge, so they need consent.
    if (!ex.ai_consent) return 'no_consent' as const;
    // The answers may have been corrected since the suggestion was drafted: re-check every quote.
    const matches = quoteMatcher(await latestAnswers(tx, sessionId));
    if (!proposal.support.every(matches)) return 'quotes_changed' as const;

    // The source note is built from the stored, verified quotes, never from the request. Whole
    // quotes only: one that does not fit is left out rather than cut off mid-sentence.
    const date = new Date(ex.created_at).toISOString().slice(0, 10);
    let sourceNote = `Brand interview with ${ex.name}${ex.role ? ` (${ex.role})` : ''}, ${date}.`;
    for (const s of proposal.support) {
      const part = ` ${s.questionId}: “${s.quote}”`;
      if (sourceNote.length + part.length + 1 > 500) break;
      sourceNote += (sourceNote.endsWith('.') ? '' : ';') + part;
    }
    const edited = input.title !== proposal.title || input.body !== proposal.body || input.kind !== proposal.kind;
    const created = await createItemTx(tx, actor, { kind: input.kind, title: input.title, body: input.body, sourceNote, origin: 'interview' }, requestId);
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'interview.proposal_saved',
      targetType: 'knowledge_version',
      targetId: created.versionId,
      details: { sessionId, extractionId: input.extractionId, index: input.index, editedBeforeSaving: edited },
      requestId,
    });
    await tx.query(
      `INSERT INTO interview_proposal_saves (extraction_id, proposal_index, knowledge_item_id, knowledge_version_id, saved_by) VALUES ($1, $2, $3, $4, $5)`,
      [input.extractionId, input.index, created.itemId, created.versionId, actor.userId],
    );
    return created;
  });
}

// ---------------------------------------------------------------------------------------------
// Interview name and practice flag

export async function updateInterview(
  db: Db,
  actor: AuthContext,
  sessionId: string,
  input: { label?: string | null; isPractice?: boolean },
  requestId?: string,
): Promise<'updated' | 'not_found'> {
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      `UPDATE interview_sessions
          SET label = CASE WHEN $3::boolean THEN $4 ELSE label END,
              is_practice = COALESCE($5, is_practice)
        WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
      [sessionId, actor.restaurantId, input.label !== undefined, input.label || null, input.isPractice ?? null],
    );
    if (rows.length === 0) return 'not_found' as const;
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'interview.updated',
      targetType: 'interview_session',
      targetId: sessionId,
      details: { label: input.label, isPractice: input.isPractice },
      requestId,
    });
    return 'updated' as const;
  });
}

// ---------------------------------------------------------------------------------------------
// Transcripts: the AI places the manager's own words under the guide's questions

export async function uploadTranscript(
  db: Db,
  actor: AuthContext,
  sessionId: string,
  input: { fileName?: string; text: string },
  requestId?: string,
): Promise<{ transcriptId: string } | 'not_found' | 'completed'> {
  const s = await getSession(db, actor.restaurantId, sessionId);
  if (!s) return 'not_found';
  if (s.status === 'completed') return 'completed';
  const [t] = await db.query<{ id: string; sha256: string }>(
    `INSERT INTO interview_transcripts (session_id, restaurant_id, file_name, body, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, sha256`,
    [sessionId, actor.restaurantId, input.fileName ?? null, input.text, actor.userId],
  );
  await recordAudit(db, {
    restaurantId: actor.restaurantId,
    actorUserId: actor.userId,
    action: 'interview.transcript_uploaded',
    targetType: 'interview_session',
    targetId: sessionId,
    details: { transcriptId: t!.id, characters: input.text.length, sha256: t!.sha256 },
    requestId,
  });
  return { transcriptId: t!.id };
}

export const transcriptOutput = z.object({
  answers: z.array(z.object({ question_id: z.string(), excerpts: z.array(z.string()) })),
  speaker_note: z.string(),
});

export type FillOutcome = TranscriptFillResult | 'not_found' | 'completed' | 'no_consent' | 'no_transcript';

/**
 * Fills guide answers from a transcript. Every excerpt must appear word for word in the
 * transcript or it is dropped, so the AI can only place the manager's real words; it can never
 * write an answer. Typed answers are kept unless the person asks to replace them.
 */
export async function fillFromTranscript(
  deps: AiDeps,
  actor: AuthContext,
  sessionId: string,
  input: { transcriptId: string; replaceTyped: boolean },
  requestId?: string,
): Promise<FillOutcome> {
  const { db } = deps;
  const s = await getSession(db, actor.restaurantId, sessionId);
  if (!s) return 'not_found';
  if (s.status === 'completed') return 'completed';
  if (!s.ai_consent) return 'no_consent';
  const [t] = await db.query<{ id: string; body: string }>(`SELECT id, body FROM interview_transcripts WHERE id = $1 AND session_id = $2`, [input.transcriptId, sessionId]);
  if (!t) return 'no_transcript';

  const ai = await guard(deps, actor, 'interview');
  const who = oneLine(`${s.interviewee_name}${s.interviewee_role ? ` (${s.interviewee_role})` : ''}`);
  const questions = INTERVIEW_QUESTIONS.map((q) => `[${q.id}] ${q.question}`).join('\n');
  const prompt = [
    `The interviewee is: ${who}`,
    '',
    'Interview guide questions:',
    questions,
    '',
    '<transcript>',
    t.body.replace(/[<>]/g, ''),
    '</transcript>',
    '',
    "Copy the interviewee's own words under the questions they answer.",
  ].join('\n');

  const res = await callProvider(deps, actor, 'interview', ai, () =>
    ai.structured({
      system: INTERVIEW_TRANSCRIPT_SYSTEM,
      documents: [],
      prompt,
      schema: transcriptOutput,
      effort: 'medium',
      maxTokens: 16000,
      mock: () => ({
        answers: [{ question_id: 'A1', excerpts: [t.body.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ')] }],
        speaker_note: '[MOCK] No AI was called.',
      }),
    }),
  );
  await recordUsage(db, {
    restaurantId: actor.restaurantId,
    userId: actor.userId,
    task: 'interview',
    provider: ai.name,
    model: res.model,
    usage: res.usage,
    outcome: res.refused ? 'refused' : res.data ? 'ok' : 'error',
  });

  const result: TranscriptFillResult = { filled: [], keptTyped: [], notCovered: [], droppedExcerpts: 0, warnings: [], provider: ai.name };
  if (!res.data) {
    result.warnings.push(
      res.refused
        ? "The assistant can't help with that transcript."
        : res.truncated
          ? 'The answer was cut off because the transcript is long. Try once more; if it happens again, split the transcript into two files.'
          : 'The assistant returned an unreadable result. Please try again.',
    );
    result.notCovered = INTERVIEW_QUESTIONS.map((q) => q.id);
    return result;
  }

  const transcript = normalizeForQuote(t.body);
  const existing = new Map((await latestAnswers(db, sessionId)).map((a) => [a.questionId, a]));
  const guideIds = new Set(INTERVIEW_QUESTIONS.map((q) => q.id));
  const byQuestion = new Map<string, string[]>();
  for (const a of res.data.answers) {
    const id = a.question_id.trim();
    if (!guideIds.has(id)) continue;
    for (const e of a.excerpts) {
      const excerpt = e.trim().slice(0, 4000);
      const n = normalizeForQuote(excerpt);
      if (!isSubstantial(n) || !transcript.includes(n)) {
        result.droppedExcerpts++;
        continue;
      }
      byQuestion.set(id, [...(byQuestion.get(id) ?? []), excerpt]);
    }
  }

  await db.transaction(async (tx) => {
    for (const q of INTERVIEW_QUESTIONS) {
      const excerpts = byQuestion.get(q.id);
      if (!excerpts?.length) {
        if (!existing.has(q.id)) result.notCovered.push(q.id);
        continue;
      }
      const current = existing.get(q.id);
      if (current && current.source === 'typed' && !input.replaceTyped) {
        result.keptTyped.push(q.id);
        continue;
      }
      await tx.query(
        `INSERT INTO interview_answers (session_id, restaurant_id, question_id, question_text, answer, recorded_by, source, transcript_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'transcript', $7)`,
        [sessionId, actor.restaurantId, q.id, q.question, excerpts.join('\n\n').slice(0, 8000), actor.userId, t.id],
      );
      result.filled.push(q.id);
    }
    await recordAudit(tx, {
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action: 'interview.filled_from_transcript',
      targetType: 'interview_session',
      targetId: sessionId,
      details: { transcriptId: t.id, filled: result.filled.length, keptTyped: result.keptTyped.length, droppedExcerpts: result.droppedExcerpts },
      requestId,
    });
  });

  if (result.droppedExcerpts) {
    result.warnings.push(`${result.droppedExcerpts} excerpt${result.droppedExcerpts === 1 ? ' was' : 's were'} not word for word in the transcript and ${result.droppedExcerpts === 1 ? 'was' : 'were'} left out.`);
  }
  const note = oneLine(res.data.speaker_note).slice(0, 300);
  if (note) result.warnings.push(`How the assistant found the interviewee: ${note} Check that every answer is their words, not the interviewer's.`);
  return result;
}
