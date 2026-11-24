import { z } from 'zod';

export const visualRecipeSchema = z.object({
  exposure: z.number().min(-1).max(1),
  warmth: z.number().min(-1).max(1),
  contrast: z.number().min(-1).max(1),
  saturation: z.number().min(-1).max(1),
  highlights: z.number().min(-1).max(1),
  shadows: z.number().min(-1).max(1),
  sharpness: z.number().min(0).max(1),
  crop: z.enum(['original', 'square', 'portrait', 'landscape']),
}).strict();
export type VisualRecipe = z.infer<typeof visualRecipeSchema>;

export const visualUploadSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().optional(),
  label: z.string().trim().min(1).max(100),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  edits: visualRecipeSchema.optional(),
}).refine((value) => Boolean(value.parentId) === Boolean(value.edits) && value.id !== value.parentId);

export const visualReviewSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(3).refine((ids) => new Set(ids).size === ids.length),
  privacyConfirmed: z.literal(true),
});
export const visualReviewResultSchema = z.object({
  observations: z.array(z.string()),
  brandConsiderations: z.array(z.string()),
  recommendations: z.array(z.string()),
  verify: z.array(z.string()),
});
export type VisualReviewResult = z.infer<typeof visualReviewResultSchema>;

export interface VisualAsset {
  id: string;
  parentId: string | null;
  label: string;
  sha256: string;
  createdAt: string;
  edits: VisualRecipe | null;
}
