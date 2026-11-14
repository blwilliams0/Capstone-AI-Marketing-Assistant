import { z } from 'zod';

/**
 * Provider abstraction for hosted AI (Architecture section 6). Stage 1 ships only a mock; a real
 * Qwen client arrives in Stage 3. The AI never receives approve/publish/invite tools, and its
 * output is always a draft.
 */
export const AI_TASKS = [
  'brand_interview',
  'brand_rule_extract',
  'marketing_question',
  'campaign_plan',
  'content_draft',
  'seo_audit',
  'photo_taking_guide',
  'research_synthesis',
  'performance_summary',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export type AiModel = 'qwen3.8-flash' | 'qwen3.7-plus';

export const aiRequestSchema = z.object({
  task: z.enum(AI_TASKS),
  prompt: z.string().min(1).max(20_000),
});
export type AiRequest = z.infer<typeof aiRequestSchema>;

export interface AiResponse {
  model: AiModel;
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** AI output is only ever a proposal. */
  status: 'draft';
  mock: boolean;
}

export interface AiProvider {
  generate(request: AiRequest): Promise<AiResponse>;
}

const PLUS_TASKS: ReadonlySet<AiTask> = new Set(['brand_interview', 'brand_rule_extract', 'research_synthesis']);

/** Flash for routine work; Plus for interviews and nuanced evidence. */
export function modelFor(task: AiTask): AiModel {
  return PLUS_TASKS.has(task) ? 'qwen3.7-plus' : 'qwen3.8-flash';
}

export function createMockAiProvider(): AiProvider {
  return {
    async generate(request) {
      const parsed = aiRequestSchema.parse(request); // never echoes or logs the prompt
      return {
        model: modelFor(parsed.task),
        text: `[MOCK AI - not real output] Draft response for task "${parsed.task}".`,
        usage: { inputTokens: Math.ceil(parsed.prompt.length / 4), outputTokens: 20 },
        status: 'draft',
        mock: true,
      };
    },
  };
}
