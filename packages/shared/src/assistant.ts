import { z } from 'zod';

export const askSchema = z.object({
  question: z.string().trim().min(3, 'Please write a question').max(2000),
  conversationId: z.string().uuid().optional(),
});
export type AskRequest = z.infer<typeof askSchema>;

export interface SourceRef {
  versionId: string;
  title: string;
  kind: string;
  /** Short quotes the answer relied on, when the model cited them. */
  quotes: string[];
}

export interface AskResponse {
  conversationId: string;
  answer: string;
  sources: SourceRef[];
  /** Everything the assistant was given for this question (brand core first, then relevant sections). */
  consulted: { title: string; kind: string; core: boolean }[];
  refused: boolean;
  provider: 'anthropic' | 'mock';
}

export const AUDIENCES = ['locals', 'tourists', 'both'] as const;
export const CHANNELS = ['instagram', 'facebook', 'email', 'google_business', 'website'] as const;

export const AUDIENCE_LABELS: Record<(typeof AUDIENCES)[number], string> = {
  locals: 'Locals and repeat guests (reasons to return)',
  tourists: 'Tourists and visitors (reasons to choose The Pocket)',
  both: 'Both audiences',
};

export const CHANNEL_LABELS: Record<(typeof CHANNELS)[number], string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  email: 'Email to opted-in guests',
  google_business: 'Google Business Profile post',
  website: 'Website text',
};

export const draftRequestSchema = z.object({
  audience: z.enum(AUDIENCES),
  channel: z.enum(CHANNELS),
  goal: z.string().trim().min(3).max(300),
  topic: z.string().trim().min(3).max(1000),
});
export type DraftRequest = z.infer<typeof draftRequestSchema>;

export interface DraftOption {
  caption: string;
  angle: string;
  whyItFits: string;
  sources: { versionId: string; title: string; kind: string }[];
}

export interface DraftResponse {
  options: DraftOption[];
  whatToConfirm: string[];
  risks: string[];
  suggestedTiming: string;
  howToMeasure: string[];
  photoTips: string[];
  /** Problems the server found in the AI output (e.g. references to unknown documents). */
  warnings: string[];
  consulted: { title: string; kind: string; core: boolean }[];
  refused: boolean;
  provider: 'anthropic' | 'mock';
}

export interface AssistantStatus {
  available: boolean;
  provider: 'anthropic' | 'mock' | 'disabled';
}
