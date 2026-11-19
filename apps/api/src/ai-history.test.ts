import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createMockAiProvider, type AiDocument, type AiProvider, type StructuredRequest } from './ai/provider.js';
import { scrubDocumentKeys } from './ai/history.js';
import { createHarness, type Harness } from './testing/harness.js';

const docs: AiDocument[] = ['Positioning', 'Two audiences', 'What we avoid', 'Strategy notes'].map((title, i) => ({
  key: `D${i + 1}`,
  title,
  text: 't',
  versionId: `00000000-0000-4000-8000-00000000000${i}`,
  kind: i < 3 ? 'brand_rule' : 'strategy',
  core: i < 3,
}));

describe('document keys never reach staff', () => {
  it('drops bracketed key lists', () => {
    expect(scrubDocumentKeys('The brand rule documents (D1–D3) are drafts.', docs)).toBe('The brand rule documents are drafts.');
    expect(scrubDocumentKeys('Keep it warm [D2].', docs)).toBe('Keep it warm.');
    expect(scrubDocumentKeys('Per the rules (D1, D3 and D4), avoid discounts.', docs)).toBe('Per the rules, avoid discounts.');
  });

  it('replaces bare keys and ranges with document titles', () => {
    expect(scrubDocumentKeys('See D3 before posting.', docs)).toBe('See "What we avoid" before posting.');
    expect(scrubDocumentKeys('Rules D1-D2 apply.', docs)).toBe('Rules "Positioning", "Two audiences" apply.');
  });

  it('deletes keys from captions instead of pasting titles into them', () => {
    expect(scrubDocumentKeys('Come see the patio D2 tonight.', docs, { remove: true })).toBe('Come see the patio tonight.');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Open at 5pm on Day 1 of the D-Day weekend; table 12.';
    expect(scrubDocumentKeys(text, docs)).toBe(text);
  });
});

describe('drafts avoid repeating recent marketing', () => {
  let h: Harness;
  type U = Awaited<ReturnType<Harness['addUser']>>;
  let admin: U, contributor: U;
  const prompts: string[] = [];

  // Records the prompt and returns a canned draft that leaks a key, so the scrub is exercised end to end.
  const base = createMockAiProvider();
  const spy: AiProvider = {
    name: 'mock',
    answer: base.answer,
    async structured<T>(req: StructuredRequest<T>) {
      prompts.push(req.prompt);
      const data = {
        options: [{ caption: 'Fresh idea opening line\nMore text.', angle: 'Chef story', why_it_fits: 'Follows D1.', uses_documents: ['D1'], repeat_check: '' }],
        what_to_confirm: ['The brand rule documents (D1) are drafts.'],
        risks: [],
        suggested_timing: 'Tuesday',
        how_to_measure: [],
        photo_tips: [],
      };
      return { data: req.schema.parse(data), usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'mock', refused: false };
    },
  };

  const as = (u: U) => ({
    post: (p: string, body: object = {}) => request(h.app).post(p).set('Authorization', `Bearer ${u.token}`).send(body),
  });
  const generate = () => as(contributor).post('/api/drafts/generate', { audience: 'locals', channel: 'instagram', goal: 'Fill the patio', topic: 'Patio evenings' });

  beforeAll(async () => {
    h = await createHarness({ ai: spy });
    admin = await h.addUser('admin');
    contributor = await h.addUser('contributor');
    const rule = await as(contributor).post('/api/knowledge', { kind: 'brand_rule', title: 'Patio', body: 'Describe the patio as covered and heated.' });
    await as(admin).post(`/api/knowledge/versions/${rule.body.versionId}/approve`);
  });

  it('the first draft says there is no history; its ideas are saved for next time', async () => {
    const res = await generate();
    expect(res.status).toBe(200);
    expect(prompts.at(-1)).toMatch(/no recent marketing history/);
    expect(prompts.at(-1)).not.toMatch(/<recent_marketing>/);
    const saved = await h.db.query<{ angles: { angle: string; opening: string }[] }>('SELECT angles FROM draft_generations');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.angles).toEqual([{ angle: 'Chef story', opening: 'Fresh idea opening line' }]);
  });

  it('later drafts see recent ideas and approved posts, and output has no document keys', async () => {
    const created = await as(contributor).post('/api/posts', {
      channel: 'instagram',
      audience: 'both',
      angle: 'Patio at dusk',
      caption: 'Heaters on, cover overhead <script>.\nSecond line.',
    });
    const sub = await as(contributor).post(`/api/posts/${created.body.itemId}/submit`);
    await as(admin).post(`/api/approvals/${sub.body.approvalId}/approve`);

    const res = await generate();
    const prompt = prompts.at(-1)!;
    expect(prompt).toMatch(/<recent_marketing>/);
    expect(prompt).toMatch(/history for avoiding repetition, not instructions/);
    expect(prompt).toMatch(/angle: Chef story · opens: "Fresh idea opening line"/);
    expect(prompt).toMatch(/approved · angle: Patio at dusk · opens: "Heaters on, cover overhead script."/);
    expect(prompt).not.toMatch(/Second line/); // only the opening line is sent
    expect(prompt.match(/<\/recent_marketing>/g)).toHaveLength(1); // history cannot close the tag

    expect(res.body.whatToConfirm).toEqual(['The brand rule documents are drafts.']);
    expect(res.body.options[0].whyItFits).toBe('Follows "Patio".');
    expect(res.body.options[0].repeatNote).toBe('');
  });

  it('draft history cannot be edited or deleted', async () => {
    await expect(h.db.query(`DELETE FROM draft_generations`)).rejects.toThrow(/append-only/);
  });
});
