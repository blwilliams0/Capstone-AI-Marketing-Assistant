import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createMockAiProvider, type AiProvider, type StructuredRequest } from './ai/provider.js';
import { normalizeForQuote } from './interview/service.js';
import { createHarness, type Harness } from './testing/harness.js';

let h: Harness;
type U = Awaited<ReturnType<Harness['addUser']>>;
let admin: U, contributor: U, viewer: U;
const prompts: { system: string; prompt: string }[] = [];
let nextExtraction: unknown = null;

// Records prompts; returns a canned extraction when one is queued, otherwise the mock's output.
const base = createMockAiProvider();
const spy: AiProvider = {
  name: 'mock',
  answer: base.answer,
  async structured<T>(req: StructuredRequest<T>) {
    prompts.push({ system: req.system, prompt: req.prompt });
    if (nextExtraction && /PROPOSED brand rules/.test(req.system)) {
      const data = req.schema.parse(nextExtraction);
      nextExtraction = null;
      return { data, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'mock', refused: false };
    }
    return base.structured(req);
  },
};

const as = (u: U) => ({
  get: (p: string) => request(h.app).get(p).set('Authorization', `Bearer ${u.token}`),
  post: (p: string, body: object = {}) => request(h.app).post(p).set('Authorization', `Bearer ${u.token}`).send(body),
});

async function start(name: string, aiConsent = true) {
  const res = await as(contributor).post('/api/interviews', { intervieweeName: name, intervieweeRole: 'GM', notesConsent: true, aiConsent });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.sessionId as string;
}
const answer = (id: string, questionId: string, text: string, questionText?: string) =>
  as(contributor).post(`/api/interviews/${id}/answers`, { questionId, answer: text, questionText });

beforeAll(async () => {
  h = await createHarness({ ai: spy });
  admin = await h.addUser('admin');
  contributor = await h.addUser('contributor');
  viewer = await h.addUser('viewer');
});

describe('brand interview: recording', () => {
  it('needs notes consent, and viewers cannot run interviews', async () => {
    expect((await as(contributor).post('/api/interviews', { intervieweeName: 'Mike', notesConsent: false, aiConsent: true })).status).toBe(400);
    expect((await as(viewer).post('/api/interviews', { intervieweeName: 'Mike', notesConsent: true, aiConsent: true })).status).toBe(403);
    expect((await as(viewer).get('/api/interviews')).status).toBe(403);
  });

  it('stores answers with the guide wording; corrections keep history; latest wins', async () => {
    const id = await start('Elliot');
    await answer(id, 'A1', 'First try', 'A made-up question text that should be ignored');
    await answer(id, 'A1', 'An intimate place where the staff know your name.');
    expect((await answer(id, 'Z9', 'x')).status).toBe(400);
    expect((await answer(id, 'A1.f1', 'Follow-up answer')).status).toBe(400); // follow-ups need the question asked
    const d = (await as(contributor).get(`/api/interviews/${id}`)).body;
    expect(d.answers).toHaveLength(1);
    expect(d.answers[0].questionText).toBe('How would you describe The Pocket to someone who has never been?');
    expect(d.answers[0].answer).toBe('An intimate place where the staff know your name.');
    const rows = await h.db.query(`SELECT 1 FROM interview_answers WHERE session_id = $1`, [id]);
    expect(rows).toHaveLength(2);
    await expect(h.db.query(`DELETE FROM interview_answers WHERE session_id = $1`, [id])).rejects.toThrow(/append-only/);
  });

  it('a completed interview accepts no more answers', async () => {
    const id = await start('Done');
    await answer(id, 'A1', 'Something');
    expect((await as(contributor).post(`/api/interviews/${id}/complete`)).status).toBe(200);
    expect((await answer(id, 'A2', 'Late')).status).toBe(409);
  });
});

describe('brand interview: AI help respects consent', () => {
  it('without AI consent, follow-ups come from the guide and drafting rules is refused', async () => {
    const id = await start('Private', false);
    await answer(id, 'B2', 'Not fun exactly. Relaxed.');
    const before = prompts.length;
    const f = await as(contributor).post(`/api/interviews/${id}/follow-up`, { questionId: 'B2' });
    expect(f.body).toEqual({ followUp: 'What does "fun" look like that would or would not fit?', questionId: 'B2.f1', source: 'guide' });
    expect((await as(contributor).post(`/api/interviews/${id}/extract`)).body.reason).toBe('no_consent');
    expect(prompts.length).toBe(before); // nothing was sent to the AI
    await expect(h.db.query(`UPDATE interview_sessions SET ai_consent = true WHERE id = $1`, [id])).rejects.toThrow(/cannot be added/);
  });

  it('with consent, the AI suggests a follow-up from the answer, and the next follow-up id is used', async () => {
    const id = await start('Mike');
    await answer(id, 'B2', 'We are warm, maybe a little playful.');
    const f = await as(contributor).post(`/api/interviews/${id}/follow-up`, { questionId: 'B2' });
    expect(f.body.source).toBe('ai');
    expect(f.body.questionId).toBe('B2.f1');
    expect(prompts.at(-1)!.prompt).toMatch(/a little playful/);
    await answer(id, 'B2.f1', 'Playful like a wink, never silly.', f.body.followUp);
    expect((await as(contributor).post(`/api/interviews/${id}/follow-up`, { questionId: 'B2' })).body.questionId).toBe('B2.f2');
  });

  it('withdrawing consent stops AI use from then on', async () => {
    const id = await start('Changes mind');
    await answer(id, 'A1', 'Cozy.');
    await as(contributor).post(`/api/interviews/${id}/withdraw-ai-consent`);
    expect((await as(contributor).post(`/api/interviews/${id}/extract`)).body.reason).toBe('no_consent');
  });
});

describe('brand interview: drafting rules', () => {
  it('keeps only quotes the manager really said, flags disagreements, and saves proposals (never approved)', async () => {
    const elliot = await start('Elliot B');
    await answer(elliot, 'B2', 'Fun is fine if it is about the food.');
    const mike = await start('Mike B');
    await answer(mike, 'B2', 'We should not try to look "fun". Warm and understated, always.');
    await answer(mike, 'B4', 'Never say luxury or exclusive.');

    nextExtraction = {
      proposals: [
        {
          kind: 'brand_rule',
          title: 'Warm and understated',
          body: 'Write warmly and with understatement; do not aim to look fun.',
          support: [
            { question_id: 'B2', quote: 'Warm and understated, always' },
            { question_id: 'B2', quote: 'We love wild parties' }, // invented: must be removed
          ],
          conflicts: ['Elliot B said fun is fine if it is about the food.'],
          verify_with: '',
        },
        {
          kind: 'brand_rule',
          title: 'Made up',
          body: 'Something nobody said.',
          support: [{ question_id: 'B4', quote: 'Always say luxury' }],
          conflicts: [],
          verify_with: '',
        },
        {
          kind: 'brand_rule',
          title: 'Words to avoid',
          body: 'Never use "luxury" or "exclusive".',
          support: [{ question_id: 'B4', quote: '“never say luxury or exclusive.”' }], // case and punctuation differ: still a match
          conflicts: [],
          verify_with: '',
        },
      ],
      open_questions: ['Is playful humour acceptable on Instagram?'],
    };
    const ex = await as(contributor).post(`/api/interviews/${mike}/extract`);
    expect(ex.status, JSON.stringify(ex.body)).toBe(200);
    expect(prompts.at(-1)!.prompt).toMatch(/<other_interviews>[\s\S]*Elliot B: Fun is fine/);
    expect(ex.body.proposals.map((p: { title: string }) => p.title)).toEqual(['Warm and understated', 'Words to avoid']);
    expect(ex.body.proposals[0].support).toEqual([{ questionId: 'B2', quote: 'Warm and understated, always' }]);
    expect(ex.body.proposals[0].conflicts[0]).toMatch(/Elliot B/);
    expect(ex.body.warnings.join(' ')).toMatch(/2 quotes did not match/);
    expect(ex.body.warnings.join(' ')).toMatch(/1 suggestion had no supporting quote/);

    // Save the first suggestion, with the reviewer's own edit to the wording.
    const saved = await as(contributor).post(`/api/interviews/${mike}/proposals`, {
      extractionId: ex.body.id,
      index: 0,
      kind: 'brand_rule',
      title: 'Warm and understated',
      body: 'Write warmly and with understatement.',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.status).toBe('proposed');
    const [kv] = await h.db.query<{ status: string; origin: string; source_note: string; body: string }>(
      `SELECT status, origin, source_note, body FROM knowledge_versions WHERE id = $1`,
      [saved.body.versionId],
    );
    expect(kv).toMatchObject({ status: 'proposed', origin: 'interview', body: 'Write warmly and with understatement.' });
    expect(kv!.source_note).toMatch(/^Brand interview with Mike B \(GM\), \d{4}-\d{2}-\d{2}\. B2: “Warm and understated, always”$/);

    expect((await as(contributor).post(`/api/interviews/${mike}/proposals`, { extractionId: ex.body.id, index: 0, kind: 'brand_rule', title: 'x', body: 'y' })).body.reason).toBe('already_saved');
    const detail = (await as(contributor).get(`/api/interviews/${mike}`)).body;
    expect(detail.extractions[0].proposals[0].savedAs.versionId).toBe(saved.body.versionId);

    // Only an administrator can then approve it, in the Knowledge library as usual.
    expect((await as(contributor).post(`/api/knowledge/versions/${saved.body.versionId}/approve`)).status).toBe(403);
    expect((await as(admin).post(`/api/knowledge/versions/${saved.body.versionId}/approve`)).status).toBe(200);
  });

  it('another restaurant cannot read or use an interview', async () => {
    const id = await start('Private to us');
    const other = await h.addUser('admin', { restaurantId: await h.addRestaurant('Other') });
    expect((await as(other).get(`/api/interviews/${id}`)).status).toBe(404);
    expect((await as(other).post(`/api/interviews/${id}/answers`, { questionId: 'A1', answer: 'x' })).status).toBe(404);
  });
});

describe('quote matching', () => {
  it('ignores case, curly quotes, spacing and edge punctuation, but not wording', () => {
    expect(normalizeForQuote('“Warm  and\nUnderstated.”')).toBe('warm and understated');
    expect(normalizeForQuote('warm and understated')).not.toBe(normalizeForQuote('warm and subtle'));
  });
});
