import request from 'supertest';
import { expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';
import { createMockAiProvider } from './provider.js';

it('keeps approved knowledge distinct from bounded private attachment excerpts and retains them in owned threads', async () => {
  const mock = createMockAiProvider();
  const prompts: string[] = [];
  const h = await createHarness({ ai: { ...mock, async answer(req) { prompts.push(req.question); return mock.answer(req); } } });
  try {
    const owner = await h.addUser('contributor');
    const peer = await h.addUser('admin');
    const post = (token: string) => request(h.app).post('/api/assistant/ask').auth(token, { type: 'bearer' });
    const documents = [{ name: 'practice.csv', content: 'channel,total\ninstagram,132\nemail,41\nunknown,0' }];
    const query = { question: 'Compare Instagram results.', documents, mode: 'strategy' };
    expect((await post(owner.token).send(query)).status).toBe(400);
    expect((await post(owner.token).send({ ...query, documentPrivacyConfirmed: true, documents: [{ name: 'unsafe.pdf', content: 'fake' }] })).status).toBe(400);
    expect(prompts).toHaveLength(0);
    const sent = await post(owner.token).send({ ...query, documentPrivacyConfirmed: true });
    expect(sent.status).toBe(200);
    expect(prompts[0]).toContain('unverified data');
    expect(prompts[0]).toContain('channel,total');
    expect(prompts[0]).toContain('instagram,132');
    expect((await post(peer.token).send({ question: 'Tell me more.', conversationId: sent.body.conversationId })).status).toBe(404);
    expect((await post(owner.token).send({ question: 'Tell me more.', conversationId: sent.body.conversationId })).status).toBe(200);
    expect(prompts[1]).toContain('practice.csv');
    await h.db.query("UPDATE advisor_documents SET created_at = now() - interval '31 days'");
    expect((await post(owner.token).send({ question: 'Tell me more.', conversationId: sent.body.conversationId })).status).toBe(200);
    expect(prompts[2]).not.toContain('practice.csv');
  } finally { await h.db.close(); }
});

it('makes a durable reservation before a simulated live provider call, including concurrent requests', async () => {
  const mock = createMockAiProvider();
  let calls = 0;
  const h = await createHarness({ evaluationMaxCalls: 1, ai: { ...mock, name: 'anthropic', async answer(req) {
    calls++;
    return mock.answer(req);
  } } });
  try {
    const staff = await h.addUser('admin');
    const send = () => request(h.app).post('/api/assistant/ask').auth(staff.token, { type: 'bearer' }).send({ question: 'Discuss a fictional restaurant.' });
    const result = await Promise.all([send(), send()]);
    expect(result.map((item) => item.status).sort()).toEqual([200, 503]);
    expect(calls).toBe(1);
    expect(await h.db.query('SELECT count(*)::int AS n FROM evaluation_provider_calls')).toEqual([{ n: 1 }]);
  } finally { await h.db.close(); }
});
