import type { z } from 'zod';

/** A piece of approved knowledge handed to the model. `key` (D1, D2, ...) is what the model sees. */
export interface AiDocument {
  key: string;
  title: string;
  text: string;
  /** The knowledge version this came from; used to turn citations back into sources. */
  versionId: string;
  kind: string;
  /** True for brand-core documents (sent first and cached). */
  core: boolean;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type Effort = 'low' | 'medium' | 'high';

export interface AnswerRequest {
  system: string;
  documents: AiDocument[];
  question: string;
  /** Recent turns, oldest first, as plain text. */
  history: { question: string; answer: string }[];
  effort: Effort;
}

export interface AnswerResult {
  text: string;
  /** Keys of the documents the answer cited, with the quoted text. */
  citations: { documentKey: string; citedText: string }[];
  usage: AiUsage;
  model: string;
  refused: boolean;
}

export interface StructuredRequest<T> {
  system: string;
  documents: AiDocument[];
  prompt: string;
  schema: z.ZodType<T>;
  effort: Effort;
  /** Used only by the mock provider (tests and local development without an API key). */
  mock: () => T;
}

export interface StructuredResult<T> {
  data: T | null;
  usage: AiUsage;
  model: string;
  refused: boolean;
}

/**
 * The application's only door to an AI model. Implementations never receive tools that can approve,
 * post, invite, change permissions or spend money: they only read documents and return text.
 */
export interface AiProvider {
  readonly name: 'anthropic' | 'mock';
  answer(req: AnswerRequest): Promise<AnswerResult>;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Deterministic stand-in: clearly labelled, makes no network calls, cites the first document if any. */
export function createMockAiProvider(): AiProvider {
  return {
    name: 'mock',
    async answer(req) {
      const first = req.documents[0];
      return {
        text: `[MOCK ANSWER - no AI was called] You asked: "${req.question.slice(0, 200)}". ${
          first ? `The most relevant approved source is "${first.title}".` : 'No approved knowledge matched this question yet.'
        }`,
        citations: first ? [{ documentKey: first.key, citedText: first.text.slice(0, 160) }] : [],
        usage: { ...ZERO, inputTokens: Math.ceil((req.question.length + req.documents.reduce((n, d) => n + d.text.length, 0)) / 4), outputTokens: 40 },
        model: 'mock',
        refused: false,
      };
    },
    async structured(req) {
      return { data: req.schema.parse(req.mock()), usage: { ...ZERO, outputTokens: 80 }, model: 'mock', refused: false };
    },
  };
}
