import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createMockAiProvider, type StructuredRequest } from '../ai/provider.js';
import { createHarness } from '../testing/harness.js';

const neutral = { exposure: 0, warmth: 0, contrast: 0, saturation: 0, highlights: 0, shadows: 0, sharpness: 0, crop: 'square' };

it('uses only eligible visual standards and preserves the current recipe in simulated revisions', async () => {
  const mock = createMockAiProvider();
  const requests: StructuredRequest<unknown>[] = [];
  const h = await createHarness({ ai: { ...mock, async structured<T>(input: StructuredRequest<T>) {
    requests.push(input as StructuredRequest<unknown>);
    if (input.prompt.includes('malformed fixture')) {
      return { data: { recipe: { ...neutral, warmth: 50 }, rationale: 'Invalid fixture' } as T, usage: {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      }, model: 'mock', refused: false };
    }
    return mock.structured(input);
  } } });
  try {
    const admin = await h.addUser('admin');
    const employee = await h.addUser('contributor');
    const outsider = await h.addUser('admin', { restaurantId: await h.addRestaurant('Other') });
    const post = (token: string, path: string) => request(h.app).post('/api' + path).auth(token, { type: 'bearer' });
    const id = randomUUID();
    const bytes = await sharp({ create: { width: 34, height: 16, channels: 3, background: 'olive' } }).jpeg().toBuffer();
    expect((await post(employee.token, '/visual/assets').type('image/jpeg')
      .set('x-photo-id', id).set('x-photo-label', 'Fixture').send(bytes)).status).toBe(201);

    const subject = randomUUID();
    const subjectBytes = await sharp({ create: { width: 31, height: 12, channels: 3, background: 'teal' } }).png().toBuffer();
    expect((await post(employee.token, '/visual/assets').type('image/png')
      .set('x-photo-id', subject).set('x-photo-label', 'Subject fixture').send(subjectBytes)).status).toBe(201);
    const reference = { kind: 'reference', title: 'Side light', category: 'Atmosphere', rationale: 'Use soft window light.', assetId: id, classification: 'on_brand' };
    expect((await post(employee.token, '/visual/standards').send(reference)).status).toBe(404);
    expect((await post(employee.token, '/visual/collections').send({ kind: 'album', name: 'Samples', visibility: 'team', items: [{ assetId: id }] })).status).toBe(201);
    const proposed = await post(employee.token, '/visual/standards').send(reference);
    expect(proposed.status).toBe(201);
    expect((await post(employee.token, '/knowledge/versions/' + proposed.body.versionId + '/approve').send({})).status).toBe(403);
    expect((await post(admin.token, '/knowledge/versions/' + proposed.body.versionId + '/approve').send({})).status).toBe(200);
    expect((await post(employee.token, '/knowledge/' + proposed.body.itemId + '/versions').send({ body: 'Bypass' })).status).toBe(409);

    const preset = { kind: 'preset', title: 'Window preset', category: 'Patio', rationale: 'A bounded warm look.', recipe: { ...neutral, warmth: 0.30 } };
    expect((await post(employee.token, '/visual/standards').send(preset)).status).toBe(403);
    const first = await post(admin.token, '/visual/standards').send(preset);
    expect(first.status).toBe(201);
    expect((await post(admin.token, '/knowledge/versions/' + first.body.versionId + '/approve').send({ confirmSelfApproval: true })).status).toBe(200);
    const pending = await post(admin.token, '/visual/standards').send({ ...preset, itemId: first.body.itemId, rationale: 'Unapproved stronger warmth.', recipe: { ...neutral, warmth: 0.9 } });
    expect(pending.status).toBe(201);
    const input = { assetId: subject, request: 'Apply Window preset', currentRecipe: neutral, privacyConfirmed: true };
    expect((await post(outsider.token, '/visual/edit-advice').send(input)).status).toBe(404);
    const suggestion = await post(employee.token, '/visual/edit-advice').send(input);
    expect(suggestion.status).toBe(200);
    expect(suggestion.body).toMatchObject({ simulated: true, recipe: { warmth: 0.3, presetVersionId: first.body.versionId } });
    expect(requests[0]!.prompt).toContain('Use soft window light.');
    expect(requests[0]!.prompt).not.toContain('Unapproved stronger warmth.');
    expect(requests[0]!.images).toHaveLength(2);
    expect(await sharp(requests[0]!.images![0]!.bytes).metadata()).toMatchObject({ format: 'jpeg', width: 31, height: 12 });
    expect(await sharp(requests[0]!.images![1]!.bytes).metadata()).toMatchObject({ format: 'jpeg', width: 34, height: 16 });
    const revision = await post(employee.token, '/visual/edit-advice').send({
      ...input, request: 'a little less warm', currentRecipe: suggestion.body.recipe, previousRequests: [input.request],
    });
    expect(JSON.parse(requests[1]!.prompt).previousRequests).toEqual([input.request]);
    expect(revision.body.recipe).toMatchObject({ warmth: 0.18, crop: 'square', presetVersionId: first.body.versionId });
    expect((await post(employee.token, '/visual/edit-advice').send({ ...input, request: 'malformed fixture' })).status).toBe(422);
    expect((await post(employee.token, '/visual/edit-advice').send({ ...input, privacyConfirmed: false })).status).toBe(400);
    await h.db.query("UPDATE visual_collections SET archived_at = now() WHERE name = 'Samples'");
    expect((await post(employee.token, '/visual/edit-advice').send(input)).status).toBe(200);
    expect(requests.at(-1)!.images).toHaveLength(1);
    const historical = await h.db.query<{ recipe: { warmth: number } }>('SELECT recipe FROM visual_standards WHERE version_id = $1', [first.body.versionId]);
    expect(historical[0]!.recipe.warmth).toBe(0.3);
  } finally { await h.db.close(); }
});

it('uses only opted-in personal preferences and accepts feedback solely for owned records', async () => {
  const mock = createMockAiProvider();
  const prompts: string[] = [];
  const h = await createHarness({ ai: { ...mock, async answer(input) {
    prompts.push(input.question);
    return mock.answer(input);
  } } });
  try {
    const alice = await h.addUser('contributor');
    const bob = await h.addUser('admin');
    const post = (token: string, path: string) => request(h.app).post('/api' + path).auth(token, { type: 'bearer' });
    const prefs = '/assistant/preferences';
    const preference = { enabled: true, detail: 'brief', workflow: 'photography' };
    expect((await post(alice.token, prefs).send(preference)).status).toBe(200);
    const question = 'What should we plan next?';
    const first = await post(alice.token, '/assistant/ask').send({ question });
    expect(first.status).toBe(200);
    expect(prompts[0]).toContain('detail=brief; workflow=photography');
    expect((await post(bob.token, '/assistant/ask').send({ question })).status).toBe(200);
    expect(prompts[1]).toBe(question);
    const feedback = { conversationId: first.body.conversationId, rating: 'correction', note: 'Use plain wording.' };
    expect((await post(bob.token, '/assistant/feedback').send(feedback)).status).toBe(404);
    expect((await post(alice.token, '/assistant/feedback').send(feedback)).status).toBe(201);
    expect(await h.db.query('SELECT note FROM advisor_feedback WHERE user_id = $1', [alice.userId])).toEqual([{ note: 'Use plain wording.' }]);
    expect((await post(alice.token, prefs).send({ enabled: false, detail: 'standard', workflow: 'none' })).status).toBe(200);
    expect((await post(alice.token, '/assistant/ask').send({ question })).status).toBe(200);
    expect(prompts[2]).toBe(question);
    expect(await h.db.query('SELECT user_id FROM advisor_preferences')).toEqual([]);
  } finally { await h.db.close(); }
});

it('shares standalone learning text only with consent and retrieves it only after management approval', async () => {
  const mock = createMockAiProvider();
  const evidence: string[] = [];
  const h = await createHarness({ ai: { ...mock, async answer(input) {
    evidence.push(input.documents.map((doc) => doc.text).join('\n'));
    return mock.answer(input);
  } } });
  try {
    const author = await h.addUser('contributor');
    const admin = await h.addUser('admin');
    const post = (token: string, path: string) => request(h.app).post('/api' + path).auth(token, { type: 'bearer' });
    const ask = () => post(author.token, '/assistant/ask').send({ question: 'How should we describe the lighting?' });
    const first = await ask();
    const feedback = await post(author.token, '/assistant/feedback').send({
      conversationId: first.body.conversationId, rating: 'correction', note: 'Private fixture detail.',
    });
    expect(feedback.status).toBe(201);
    const endpoint = '/assistant/feedback/' + feedback.body.id + '/propose';
    const share = { title: 'Lighting guidance', body: 'Describe the room in plain, sensory language.', evidence: 'Reviewed in a practice writing exercise.', shareConfirmed: true };
    expect((await post(admin.token, endpoint).send(share)).status).toBe(404);
    expect((await post(author.token, endpoint).send({ ...share, shareConfirmed: false })).status).toBe(400);
    const proposal = await post(author.token, endpoint).send(share);
    expect(proposal.status).toBe(201);
    expect((await post(author.token, endpoint).send(share)).body).toEqual(proposal.body);
    const queue = (token: string) => request(h.app).get('/api/assistant/learnings').auth(token, { type: 'bearer' });
    expect((await queue(author.token)).status).toBe(403);
    expect((await queue(admin.token)).body).toEqual({ itemIds: [proposal.body.itemId] });
    expect((await ask()).status).toBe(200);
    expect(evidence.at(-1)).not.toContain(share.body);
    expect((await post(admin.token, '/knowledge/versions/' + proposal.body.versionId + '/approve').send({})).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect(evidence.at(-1)).toContain(share.body);
    expect(evidence.at(-1)).toContain(share.evidence);
    expect(evidence.at(-1)).not.toContain('Private fixture detail.');
  } finally { await h.db.close(); }
});
