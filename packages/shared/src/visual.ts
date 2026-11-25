import { z } from 'zod';

export const visualRecipeSchema = z.object({
  exposure: z.number().min(-1).max(1),
  warmth: z.number().min(-1).max(1),
  contrast: z.number().min(-1).max(1),
  saturation: z.number().min(-1).max(1),
  highlights: z.number().min(-1).max(1),
  shadows: z.number().min(-1).max(1),
  sharpness: z.number().min(0).max(1),
  presetVersionId: z.uuid().optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
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
  suggestedRecipe: visualRecipeSchema.optional(),
});
export type VisualReviewResult = z.infer<typeof visualReviewResultSchema>;

export interface VisualAsset {
  id: string;
  owned?: boolean;
  parentId: string | null;
  label: string;
  sha256: string;
  createdAt: string;
  edits: VisualRecipe | null;
}

export const collectionKindSchema = z.enum(['album', 'feed']);
export const collectionVisibilitySchema = z.enum(['private', 'team', 'management']);
export const collectionEntrySchema = z.object({ assetId: z.uuid(), existingFeed: z.boolean().default(false) });
export const collectionInputSchema = z.object({
  kind: collectionKindSchema,
  name: z.string().trim().min(1).max(80),
  visibility: collectionVisibilitySchema,
  items: z.array(collectionEntrySchema).max(100),
  revision: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => item.assetId)).size !== value.items.length
    || (value.kind === 'feed' && value.items.length > 24)
    || (value.kind === 'album' && value.items.some((item) => item.existingFeed))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid collection entries.' });
  }
});
export type VisualCollection = Omit<z.output<typeof collectionInputSchema>, 'revision'> & {
  id: string;
  revision: number;
  editable: boolean;
};

export const practicePhotoPresets = [
  { name: 'The Signature', edits: { warmth: 0.12, contrast: 0.03, saturation: -0.06, sharpness: 0.08 } },
  { name: 'Evening at The Pocket', edits: { exposure: 0.15, warmth: 0.08, highlights: -0.22, shadows: 0.16 } },
  { name: 'Carmel Daylight', edits: { warmth: -0.05, exposure: 0.07, highlights: -0.2, saturation: -0.04 } },
  { name: 'Behind the Experience', edits: { contrast: 0.13, saturation: -0.09, shadows: 0.08, sharpness: 0.15 } },
];


export const visualEditRequestSchema = z.object({
  assetId: z.uuid(),
  request: z.string().trim().min(3).max(2000),
  currentRecipe: visualRecipeSchema,
  privacyConfirmed: z.literal(true),
});
export const visualEditResultSchema = z.object({
  recipe: visualRecipeSchema,
  rationale: z.string().trim().min(1).max(1000),
});
export type VisualEditResult = z.infer<typeof visualEditResultSchema>;

const standardText = {
  title: z.string().trim().min(1).max(100),
  rationale: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(60),
  itemId: z.uuid().optional(),
};
export const visualStandardInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...standardText, kind: z.literal('reference'), assetId: z.uuid(), classification: z.enum(['on_brand', 'off_brand', 'adjust', 'inspiration']) }),
  z.object({ ...standardText, kind: z.literal('preset'), recipe: visualRecipeSchema.refine((recipe) => !recipe.presetVersionId) }),
]);
export interface VisualStandard {
  itemId: string;
  versionId: string;
  version: number;
  title: string;
  rationale: string;
  category: string;
  kind: 'reference' | 'preset';
  status: 'proposed' | 'approved' | 'rejected' | 'superseded';
  assetId: string | null;
  classification: 'on_brand' | 'off_brand' | 'adjust' | 'inspiration' | null;
  recipe: VisualRecipe | null;
}
