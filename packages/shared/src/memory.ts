import { z } from 'zod';

export const advisorPreferenceSchema = z.object({
  enabled: z.boolean(),
  detail: z.enum(['standard', 'brief', 'detailed']),
  workflow: z.enum(['none', 'brainstorm', 'writing', 'photography']),
}).strict();
export type AdvisorPreference = z.infer<typeof advisorPreferenceSchema>;
export const defaultAdvisorPreference: AdvisorPreference = { enabled: false, detail: 'standard', workflow: 'none' };

export const advisorFeedbackSchema = z.object({
  conversationId: z.uuid().optional(),
  reviewId: z.uuid().optional(),
  rating: z.enum(['helpful', 'unhelpful', 'on_brand', 'off_brand', 'correction']),
  note: z.string().trim().max(1000).optional(),
}).refine((value) => Boolean(value.conversationId) !== Boolean(value.reviewId));
