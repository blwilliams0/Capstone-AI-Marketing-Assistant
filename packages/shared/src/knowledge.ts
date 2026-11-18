import { z } from 'zod';

export const KNOWLEDGE_KINDS = ['brand_rule', 'fact', 'strategy', 'reference'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Plain-English names and explanations for the four knowledge classes (PRD principle 2). */
export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, { name: string; description: string }> = {
  brand_rule: {
    name: 'Brand rules',
    description: 'How The Pocket presents itself: positioning, tone, what to say and never say. Approved by management.',
  },
  fact: {
    name: 'Verified facts',
    description: 'Current, checkable details: hours, dishes, events, prices. Each records who verified it and when it expires.',
  },
  strategy: {
    name: 'Marketing strategy',
    description: "The team's marketing plan. Guides advice once management approves it.",
  },
  reference: {
    name: 'Research and reference',
    description: 'Marketing research and examples. Can inform suggestions but never overrides brand rules.',
  },
};

/** Brand core is sent with every AI request, so it must stay small. */
export const BRAND_CORE_MAX_WORDS = 4000;

export const knowledgeKindSchema = z.enum(KNOWLEDGE_KINDS);

const bodySchema = z.string().trim().min(1, 'Text is required').max(90_000, 'Text is too long (90,000 characters maximum)');
const sourceNoteSchema = z.string().trim().max(500).optional();
const expiresAtSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .refine((v) => v === undefined || new Date(v).getTime() > Date.now(), 'Expiry must be in the future');

export const createKnowledgeSchema = z.object({
  kind: knowledgeKindSchema,
  title: z.string().trim().min(1).max(200),
  body: bodySchema,
  sourceNote: sourceNoteSchema,
  expiresAt: expiresAtSchema,
});
export type CreateKnowledgeRequest = z.infer<typeof createKnowledgeSchema>;

export const proposeVersionSchema = z.object({
  body: bodySchema,
  sourceNote: sourceNoteSchema,
  expiresAt: expiresAtSchema,
});
export type ProposeVersionRequest = z.infer<typeof proposeVersionSchema>;

export const decideVersionSchema = z.object({
  note: z.string().trim().max(500).optional(),
  /** Required when an administrator approves something they proposed themselves. */
  confirmSelfApproval: z.boolean().optional(),
});

export const rejectVersionSchema = z.object({
  note: z.string().trim().min(1, 'Please say why it was rejected').max(500),
});

export const retireItemSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const setBrandCoreSchema = z.object({
  inBrandCore: z.boolean(),
});

export const searchKnowledgeSchema = z.object({
  q: z.string().trim().min(2).max(300),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type VersionStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

export interface KnowledgeVersionView {
  id: string;
  version: number;
  body: string;
  digest: string;
  origin: 'human' | 'interview' | 'ai_proposal';
  status: VersionStatus;
  sourceNote: string | null;
  proposedBy: { id: string; name: string };
  proposedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export interface KnowledgeItemView {
  id: string;
  kind: KnowledgeKind;
  title: string;
  inBrandCore: boolean;
  retired: boolean;
  current: KnowledgeVersionView | null;
  pending: KnowledgeVersionView[];
}
