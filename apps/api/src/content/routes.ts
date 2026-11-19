import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import { approvePostSchema, createPostSchema, decisionNoteSchema, editPostSchema, markPostedSchema, submitPostSchema } from '@the-pocket/shared';
import { badRequest } from '../knowledge/routes.js';
import type { PolicyRouter } from '../policy.js';
import {
  archivePost,
  createPost,
  decidePost,
  editPost,
  getPost,
  listActivity,
  listPosts,
  markPosted,
  readyToPost,
  submitPost,
  withdrawRequest,
  type DecisionOutcome,
  type MarkPostedOutcome,
} from './service.js';

const itemParam = z.object({ itemId: z.string().uuid() });
const approvalParam = z.object({ approvalId: z.string().uuid() });
const listQuery = z.object({ archived: z.enum(['true', 'false']).optional() });
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

const send = (res: Response, status: number, body: object) => res.status(status).json(body);
const fail = (res: Response, status: number, error: string, reason: string) => send(res, status, { error, reason });

const STALE = 'This post relies on brand rules or facts that have changed. Save an edit to update its sources, then get it approved again.';

const DECISION: Record<DecisionOutcome, [number, string]> = {
  approved: [200, 'Approved. It is now in Ready to post.'],
  self_approved: [200, 'Approved (your own post). It is now in Ready to post.'],
  rejected: [200, 'Marked as not approved.'],
  changes_requested: [200, 'Sent back with your requested changes.'],
  not_found: [404, 'That approval request was not found.'],
  not_pending: [409, 'That request has already been decided, withdrawn or replaced by an edit.'],
  self_not_allowed: [403, 'You wrote or submitted this post, so someone else must approve it. Only administrators may approve their own posts.'],
  needs_self_confirmation: [409, 'You wrote or submitted this post. To approve your own work, confirm that you have reviewed it (confirmSelfApproval).'],
  stale_sources: [409, STALE],
};

const POSTED: Record<MarkPostedOutcome, [number, string]> = {
  posted: [200, 'Recorded as posted.'],
  not_found: [404, 'That approval was not found.'],
  not_approved: [409, 'This post is no longer approved (it may have been edited). Refresh the page.'],
  already_posted: [409, 'This post has already been marked as posted.'],
  digest_mismatch: [409, 'The text on your screen is not the approved version. Refresh the page and copy the text again.'],
  stale_sources: [409, STALE],
  archived: [409, 'This post has been archived.'],
};

export function addContentRoutes(r: PolicyRouter, db: Db) {
  r.get('/posts', 'content.view', async (req, res) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    res.json({ posts: await listPosts(db, req.auth!.restaurantId, { includeArchived: q.data.archived === 'true' }) });
  });

  r.get('/posts/ready', 'post.record', async (req, res) => {
    res.json({ ready: await readyToPost(db, req.auth!.restaurantId) });
  });

  r.get('/activity', 'content.view', async (req, res) => {
    const q = activityQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    res.json({ activity: await listActivity(db, req.auth!.restaurantId, q.data.limit) });
  });

  r.get('/posts/:itemId', 'content.view', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const post = await getPost(db, req.auth!.restaurantId, p.data.itemId);
    if (!post) return fail(res, 404, 'Post not found.', 'not_found');
    res.json(post);
  });

  r.post('/posts', 'content.draft', async (req, res) => {
    const b = createPostSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await createPost(db, req.auth!, b.data, req.requestId);
    if (out === 'invalid_sources') return fail(res, 400, 'A post can only cite approved, current knowledge.', 'invalid_sources');
    send(res, 201, out);
  });

  r.post('/posts/:itemId/versions', 'content.draft', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = editPostSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await editPost(db, req.auth!, p.data.itemId, b.data, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Post not found.', out);
    if (out === 'archived') return fail(res, 409, 'This post has been archived.', out);
    if (out === 'posted') return fail(res, 409, 'This post has already been published. Start a new post instead.', out);
    send(res, 201, out);
  });

  r.post('/posts/:itemId/submit', 'approval.request', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = submitPostSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const out = await submitPost(db, req.auth!, p.data.itemId, b.data.note, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Post not found.', out);
    if (out === 'archived') return fail(res, 409, 'This post has been archived.', out);
    if (out === 'posted') return fail(res, 409, 'This post has already been published.', out);
    if (out === 'already_open') return fail(res, 409, 'This post is already waiting for approval or approved.', out);
    send(res, 201, out);
  });

  r.post('/posts/:itemId/archive', 'content.draft', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const out = await archivePost(db, req.auth!, p.data.itemId, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'Post not found.', out);
    if (out === 'already_archived') return fail(res, 409, 'Already archived.', out);
    if (out === 'posted') return fail(res, 409, 'A published post stays in the history and cannot be archived.', out);
    if (out === 'not_allowed') return fail(res, 403, 'Only the person who started this post, or an approver, can archive it.', out);
    send(res, 200, { status: 'archived' });
  });

  const decide = (decision: 'approve' | 'reject' | 'request_changes'): RequestHandler => async (req, res) => {
    const p = approvalParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = decision === 'approve' ? approvePostSchema.safeParse(req.body ?? {}) : decisionNoteSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const outcome = await decidePost(db, req.auth!, p.data.approvalId, decision, b.data, req.requestId);
    const [status, message] = DECISION[outcome];
    send(res, status, status < 400 ? { status: outcome, message } : { error: message, reason: outcome });
  };
  r.post('/approvals/:approvalId/approve', 'post.approve', decide('approve'));
  r.post('/approvals/:approvalId/reject', 'post.approve', decide('reject'));
  r.post('/approvals/:approvalId/request-changes', 'post.approve', decide('request_changes'));

  r.post('/approvals/:approvalId/withdraw', 'approval.request', async (req, res) => {
    const p = approvalParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const out = await withdrawRequest(db, req.auth!, p.data.approvalId, req.requestId);
    if (out === 'not_found') return fail(res, 404, 'That request was not found.', out);
    if (out === 'not_pending') return fail(res, 409, 'Only a request that is still waiting can be withdrawn.', out);
    if (out === 'not_yours') return fail(res, 403, 'Only the person who submitted it (or an administrator) can withdraw it.', out);
    send(res, 200, { status: 'withdrawn' });
  });

  r.post('/approvals/:approvalId/posted', 'post.record', async (req, res) => {
    const p = approvalParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = markPostedSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const outcome = await markPosted(db, req.auth!, p.data.approvalId, b.data, req.requestId);
    const [status, message] = POSTED[outcome];
    send(res, status, status < 400 ? { status: outcome, message } : { error: message, reason: outcome });
  });
}
