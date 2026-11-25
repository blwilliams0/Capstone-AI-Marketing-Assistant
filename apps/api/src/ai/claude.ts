import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { AiDocument, AiProvider, AiUsage, AnswerRequest, StructuredRequest } from './provider.js';

export const CLAUDE_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The subset of the SDK client this provider uses, so tests can pass a fake (no network). */
export interface ClaudeClient {
  beta: {
    messages: {
      create: Anthropic['beta']['messages']['create'];
      parse: Anthropic['beta']['messages']['parse'];
    };
  };
}

type DocBlock = Anthropic.Beta.Messages.BetaRequestDocumentBlock;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

/**
 * Documents go first in the user turn: brand core (stable, cached), then question-specific sections.
 * Retrieved text is wrapped as documents, which the system prompt tells the model to treat as data.
 */
export function toDocumentBlocks(documents: AiDocument[], citations: boolean): DocBlock[] {
  const lastCore = documents.map((d) => d.core).lastIndexOf(true);
  return documents.map((d, i) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: d.text },
    title: `[${d.key}] ${d.title}`,
    context: `Knowledge class: ${d.kind}. Approved by The Pocket's management.`,
    ...(citations ? { citations: { enabled: true } } : {}),
    ...(i === lastCore ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
}

function usageOf(u: Anthropic.Beta.Messages.BetaUsage | undefined): AiUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

function historyText(history: AnswerRequest['history']): ContentBlock[] {
  if (history.length === 0) return [];
  const text = history.map((h) => `Staff asked: ${h.question}\nYou answered: ${h.answer}`).join('\n\n');
  return [{ type: 'text', text: `Earlier in this conversation (for context only):\n\n${text}` }];
}

export function createClaudeAiProvider(client: ClaudeClient, evaluation = false): AiProvider {
  return {
    name: 'anthropic',

    async answer(req) {
      const response = await client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: evaluation ? 1800 : 4000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        inference_geo: 'us',
        output_config: { effort: req.effort },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [...toDocumentBlocks(req.documents, true), ...historyText(req.history), { type: 'text', text: req.question }],
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        return { text: '', citations: [], usage: usageOf(response.usage), model: response.model, refused: true };
      }
      let text = '';
      const citations: { documentKey: string; citedText: string }[] = [];
      for (const block of response.content) {
        if (block.type !== 'text') continue;
        text += block.text;
        for (const c of block.citations ?? []) {
          if (c.type === 'char_location' || c.type === 'page_location' || c.type === 'content_block_location') {
            const doc = req.documents[c.document_index];
            if (doc) citations.push({ documentKey: doc.key, citedText: c.cited_text });
          }
        }
      }
      return { text: text.trim(), citations, usage: usageOf(response.usage), model: response.model, refused: false };
    },

    async structured<T>(req: StructuredRequest<T>) {
      // Long jobs (rule drafting from a whole interview) get more output room and more time, but
      // fewer retries, so a person is never left waiting many minutes.
      const long = (req.maxTokens ?? 8000) > 8000;
      const response = await client.beta.messages.parse(
        {
          model: CLAUDE_MODEL,
          max_tokens: evaluation ? Math.min(req.maxTokens ?? 2400, 2400) : req.maxTokens ?? 8000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          inference_geo: 'us',
          output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: [
            ...toDocumentBlocks(req.documents, false),
            ...(req.images ?? []).map((image) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: image.mediaType, data: Buffer.from(image.bytes).toString('base64') },
            })),
            { type: 'text', text: req.prompt },
          ] }],
        },
        long && !evaluation ? { timeout: 300_000, maxRetries: 1 } : undefined,
      );
      const refused = response.stop_reason === 'refusal';
      const truncated = response.stop_reason === 'max_tokens';
      return {
        data: refused || truncated ? null : ((response.parsed_output as T | null) ?? null),
        usage: usageOf(response.usage),
        model: response.model,
        refused,
        truncated,
      };
    },
  };
}

export function createClaudeClient(apiKey: string, evaluation = false): ClaudeClient {
  return new Anthropic({ apiKey, maxRetries: evaluation ? 0 : 2, timeout: evaluation ? 45_000 : 120_000 });
}
