import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  fillFromTranscriptSchema,
  followUpSchema,
  saveAnswerSchema,
  saveInterviewProposalSchema,
  startInterviewSchema,
  updateInterviewSchema,
  uploadTranscriptSchema,
} from '@the-pocket/shared';
import { AiUnavailableError, type AiDeps } from '../ai/assistant.js';
import { badRequest } from '../knowledge/routes.js';
import type { PolicyRouter } from '../policy.js';
import {
  completeInterview,
  extractProposals,
  fillFromTranscript,
  updateInterview,
  uploadTranscript,
  getInterview,
  listInterviews,
  saveAnswer,
  saveProposal,
  startInterview,
  suggestFollowUp,
  withdrawAiConsent,
} from './service.js';

const sessionParam = z.object({ sessionId: z.string().uuid() });
const fail = (res: Response, status: number, error: string, reason: string) => res.status(status).json({ error, reason });

const AI_UNAVAILABLE: Record<AiUnavailableError['reason'], [number, string]> = {
  disabled: [503, 'The AI assistant is not set up. You can still record answers and draft rules by hand.'],
  budget: [503, "This month's AI budget has been reached. Answers are still saved."],
  provider_error: [502, 'The AI is not responding right now. Your answers are saved; please try again in a minute.'],
};

async function withAi(res: Response, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      const [status, message] = AI_UNAVAILABLE[err.reason];
      fail(res, status, message, err.reason);
      return;
    }
    throw err;
  }
}

export function addInterviewRoutes(r: PolicyRouter, deps: AiDeps, aiLimit: RequestHandler) {
  const { db } = deps;

  r.get('/interviews', 'interview.conduct', async (req, res) => {
    res.json({ interviews: await listInterviews(db, req.auth!.restaurantId) });
  });

  r.post('/interviews', 'interview.conduct', async (req, res) => {
    const b = startInterviewSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    res.status(201).json(await startInterview(db, req.auth!, b.data, req.requestId));
  });

  r.get('/interviews/:sessionId', 'interview.conduct', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const s = await getInterview(db, req.auth!.restaurantId, p.data.sessionId);
    if (!s) return fail(res, 404, 'Interview not found.', 'not_found');
    res.json(s);
  });

  r.post('/interviews/:sessionId/answers', 'interview.conduct', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = saveAnswerSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await saveAnswer(db, req.auth!, p.data.sessionId, b.data);
    if (out === 'not_found') return fail(res, 404, 'Interview not found.', out);
    if (out === 'completed') return fail(res, 409, 'This interview is completed; answers can no longer be changed.', out);
    if (out === 'needs_question_text') return fail(res, 400, 'Include the follow-up question that was asked.', out);
    res.status(201).json({ status: 'saved' });
  });

  r.post('/interviews/:sessionId/follow-up', 'interview.conduct', aiLimit, async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = followUpSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    await withAi(res, async () => {
      const out = await suggestFollowUp(deps, req.auth!, p.data.sessionId, b.data.questionId);
      if (out === 'not_found') return void fail(res, 404, 'Interview not found.', out);
      if (out === 'completed') return void fail(res, 409, 'This interview is completed.', out);
      if (out === 'no_answer') return void fail(res, 409, 'Save an answer to this question first.', out);
      if (out === 'too_many') return void fail(res, 409, 'That is plenty of follow-ups for one question.', out);
      res.json(out);
    });
  });

  r.post('/interviews/:sessionId/complete', 'interview.conduct', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const out = await completeInterview(db, req.auth!, p.data.sessionId, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Interview not found.', out);
    if (out === 'already_completed') return fail(res, 409, 'Already completed.', out);
    res.json({ status: 'completed' });
  });

  r.post('/interviews/:sessionId/withdraw-ai-consent', 'interview.conduct', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const out = await withdrawAiConsent(db, req.auth!, p.data.sessionId, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Interview not found.', out);
    res.json({ status: 'withdrawn' });
  });

  r.post('/interviews/:sessionId/extract', 'interview.conduct', aiLimit, async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    await withAi(res, async () => {
      const out = await extractProposals(deps, req.auth!, p.data.sessionId, req.requestId);
      if (out === 'not_found') return void fail(res, 404, 'Interview not found.', out);
      if (out === 'no_consent') return void fail(res, 409, 'The interviewee did not agree to AI use. Draft brand rules by hand in Knowledge instead.', out);
      if (out === 'no_answers') return void fail(res, 409, 'Record some answers first.', out);
      res.json(out);
    });
  });

  r.post('/interviews/:sessionId/details', 'interview.conduct', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = updateInterviewSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const out = await updateInterview(db, req.auth!, p.data.sessionId, b.data, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Interview not found.', out);
    res.json({ status: 'updated' });
  });

  r.post('/interviews/:sessionId/transcripts', 'interview.conduct', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = uploadTranscriptSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await uploadTranscript(db, req.auth!, p.data.sessionId, b.data, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Interview not found.', out);
    if (out === 'completed') return fail(res, 409, 'This interview is completed; transcripts can no longer be added.', out);
    res.status(201).json(out);
  });

  r.post('/interviews/:sessionId/transcripts/fill', 'interview.conduct', aiLimit, async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = fillFromTranscriptSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    await withAi(res, async () => {
      const out = await fillFromTranscript(deps, req.auth!, p.data.sessionId, b.data, req.requestId);
      if (out === 'not_found') return void fail(res, 404, 'Interview not found.', out);
      if (out === 'completed') return void fail(res, 409, 'This interview is completed.', out);
      if (out === 'no_consent') return void fail(res, 409, 'The interviewee did not agree to AI use, so the transcript cannot be read by the AI. Type the answers in instead.', out);
      if (out === 'no_transcript') return void fail(res, 404, 'Transcript not found.', out);
      res.json(out);
    });
  });

  r.post('/interviews/:sessionId/proposals', 'knowledge.propose', async (req, res) => {
    const p = sessionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = saveInterviewProposalSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await saveProposal(db, req.auth!, p.data.sessionId, b.data, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'That suggestion was not found.', out);
    if (out === 'already_saved') return fail(res, 409, 'That suggestion has already been saved.', out);
    if (out === 'no_consent') return fail(res, 409, 'AI consent was withdrawn for this interview, so its suggestions can no longer be saved. Write the rule by hand in Knowledge.', out);
    if (out === 'quotes_changed') return fail(res, 409, 'The answers have changed since this was drafted, so its quotes no longer match. Draft brand rules again.', out);
    res.status(201).json({ ...out, status: 'proposed' });
  });
}
