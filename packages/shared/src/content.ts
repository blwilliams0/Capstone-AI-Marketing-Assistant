import { z } from 'zod';
import { AUDIENCES, CHANNELS } from './assistant.js';

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createPostSchema = z.object({
  title: optionalText(200),
  channel: z.enum(CHANNELS),
  audience: z.enum(AUDIENCES),
  angle: optionalText(300),
  caption: z.string().trim().min(1, 'Write the post text').max(10000),
  photoPlan: optionalText(4000),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  /** Approved knowledge versions the text relies on (from an AI draft's sources). */
  sourceVersionIds: z.array(z.string().uuid()).max(20).default([]),
  origin: z.enum(['human', 'ai_draft']).default('human'),
});
export type CreatePostRequest = z.input<typeof createPostSchema>;

/** Saving an edit creates a new version. Omitted fields keep their previous value. */
export const editPostSchema = z.object({
  caption: z.string().trim().min(1, 'Write the post text').max(10000),
  angle: optionalText(300),
  photoPlan: optionalText(4000),
  channel: z.enum(CHANNELS).optional(),
  audience: z.enum(AUDIENCES).optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});
export type EditPostRequest = z.input<typeof editPostSchema>;

export const submitPostSchema = z.object({ note: optionalText(1000) });

export const approvePostSchema = z.object({
  note: optionalText(1000),
  /** Required when an administrator approves a post they wrote or submitted. */
  confirmSelfApproval: z.boolean().optional(),
});

export const decisionNoteSchema = z.object({
  note: z.string().trim().min(1, 'Please say what needs to change').max(1000),
});

export const markPostedSchema = z.object({
  /** The fingerprint shown on the Ready to post card; must match the approved version. */
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'Missing approval fingerprint'),
  postUrl: z
    .string()
    .trim()
    .max(2000)
    .regex(/^https?:\/\//, 'Paste the full link, starting with https://')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  note: optionalText(1000),
});

export const POST_STATUSES = ['draft', 'in_review', 'changes_requested', 'rejected', 'approved', 'posted', 'archived'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  in_review: 'Waiting for approval',
  changes_requested: 'Changes requested',
  rejected: 'Not approved',
  approved: 'Approved, ready to post',
  posted: 'Posted',
  archived: 'Archived',
};

export const APPROVAL_EVENT_LABELS: Record<string, string> = {
  submitted: 'submitted for approval',
  approved: 'approved',
  self_approved: 'approved their own post',
  rejected: 'did not approve',
  changes_requested: 'asked for changes',
  withdrawn: 'withdrew the request',
  superseded: 'changed or archived the post (the earlier approval no longer applies)',
  posted: 'marked as posted',
};

export interface PersonRef {
  id: string;
  name: string;
}

export interface PostSource {
  versionId: string;
  title: string;
  kind: string;
  /** False when this knowledge was replaced, retired or expired after the post was written. */
  current: boolean;
  problem: string | null;
}

export interface PostVersionView {
  id: string;
  version: number;
  channel: (typeof CHANNELS)[number];
  audience: (typeof AUDIENCES)[number];
  angle: string;
  caption: string;
  photoPlan: string;
  scheduledFor: string | null;
  origin: 'human' | 'ai_draft';
  createdBy: PersonRef;
  createdAt: string;
  digest: string;
  sources: PostSource[];
  /** Sources an edit removed because that rule or fact was retired or expired. */
  removedSources: PostSource[];
}

export interface ApprovalView {
  id: string;
  versionId: string;
  version: number;
  digest: string;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'withdrawn' | 'superseded';
  requestedBy: PersonRef;
  requestedAt: string;
  requestNote: string | null;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  selfApproved: boolean;
}

export interface PostRecordView {
  postedBy: PersonRef;
  postedAt: string;
  postUrl: string | null;
  note: string | null;
  digest: string;
}

export interface ActivityEntry {
  id: string;
  itemId: string;
  postTitle: string;
  event: string;
  actor: PersonRef | null;
  note: string | null;
  digest: string;
  at: string;
}

export interface PostSummary {
  id: string;
  title: string;
  status: PostStatus;
  channel: (typeof CHANNELS)[number];
  audience: (typeof AUDIENCES)[number];
  latestVersion: number;
  excerpt: string;
  createdBy: PersonRef;
  updatedAt: string;
  /** Problems that block posting (e.g. a brand rule it relies on changed). */
  blockers: string[];
}

export interface PostDetail {
  id: string;
  title: string;
  status: PostStatus;
  createdBy: PersonRef;
  createdAt: string;
  versions: PostVersionView[];
  approvals: ApprovalView[];
  /** The open request (pending or approved) for the latest version, if any. */
  openApproval: ApprovalView | null;
  post: PostRecordView | null;
  activity: ActivityEntry[];
  blockers: string[];
}

export interface ReadyToPostCard {
  itemId: string;
  approvalId: string;
  title: string;
  version: PostVersionView;
  approvedBy: PersonRef;
  approvedAt: string;
  selfApproved: boolean;
  digest: string;
  blockers: string[];
}
