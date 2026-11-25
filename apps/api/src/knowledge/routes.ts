import type { Response } from 'express';
import { z } from 'zod';
import type { Db } from '@the-pocket/db';
import {
  createKnowledgeSchema,
  decideVersionSchema,
  proposeVersionSchema,
  rejectVersionSchema,
  retireItemSchema,
  searchKnowledgeSchema,
  setBrandCoreSchema,
} from '@the-pocket/shared';
import type { PolicyRouter } from '../policy.js';
import {
  createItem,
  decideVersion,
  getBrandCore,
  getHistory,
  listItems,
  proposeVersion,
  retireItem,
  searchSections,
  setBrandCore,
  type DecideOutcome,
} from './service.js';

const itemParam = z.object({ itemId: z.string().uuid() });
const versionParam = z.object({ versionId: z.string().uuid() });

export function badRequest(res: Response, error: z.ZodError) {
  res.status(400).json({
    error: 'Some details are missing or invalid.',
    problems: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

const DECIDE_RESPONSES: Record<DecideOutcome, [number, string]> = {
  approved: [200, 'Approved.'],
  self_approved: [200, 'Approved (your own proposal).'],
  rejected: [200, 'Rejected.'],
  not_found: [404, 'That version was not found.'],
  not_pending: [409, 'That version has already been decided.'],
  retired: [409, 'That item has been retired.'],
  expired: [409, 'That fact has already expired. Propose an updated version instead.'],
  needs_self_confirmation: [
    409,
    'You proposed this yourself. To approve your own work, confirm that you have reviewed it (confirmSelfApproval).',
  ],
  core_too_large: [
    409,
    'Approving this would make the brand core too long. Remove something from the brand core or shorten this text.',
  ],
};

export function addKnowledgeRoutes(r: PolicyRouter, db: Db) {
  const canSeePending = (caps: readonly string[]) => caps.includes('knowledge.propose');

  r.get('/knowledge', 'knowledge.view', async (req, res) => {
    const a = req.auth!;
    res.json({ items: await listItems(db, a.restaurantId, { includePending: canSeePending(a.capabilities) }) });
  });

  r.get('/knowledge/brand-core', 'knowledge.view', async (req, res) => {
    res.json(await getBrandCore(db, req.auth!.restaurantId));
  });

  r.get('/knowledge/search', 'knowledge.view', async (req, res) => {
    const q = searchKnowledgeSchema.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    res.json({ hits: await searchSections(db, req.auth!.restaurantId, q.data.q, q.data.limit) });
  });

  r.get('/knowledge/:itemId', 'knowledge.view', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const a = req.auth!;
    const h = await getHistory(db, a.restaurantId, p.data.itemId, { includeAll: canSeePending(a.capabilities) });
    if (!h) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
    res.json({
      item: { id: h.item.id, kind: h.item.kind, title: h.item.title, inBrandCore: h.item.in_brand_core, retired: h.item.retired_at !== null },
      versions: h.versions,
    });
  });

  r.post('/knowledge', 'knowledge.propose', async (req, res) => {
    const b = createKnowledgeSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await createItem(db, req.auth!, b.data, req.requestId);
    res.status(201).json({ ...out, status: 'proposed' });
  });

  r.post('/knowledge/:itemId/versions', 'knowledge.propose', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = proposeVersionSchema.safeParse(req.body);
    if (!b.success) return badRequest(res, b.error);
    const out = await proposeVersion(db, req.auth!, p.data.itemId, b.data, req.requestId);
    if (out === 'not_found') res.status(404).json({ error: 'Not found.' });
    else if (out === 'retired') res.status(409).json({ error: 'That item has been retired.' });
    else if (out === 'visual_required') res.status(409).json({ error: 'Revise the reference or preset through Visual Standards.' });
    else res.status(201).json({ ...out, status: 'proposed' });
  });

  r.post('/knowledge/versions/:versionId/approve', 'brand.approve', async (req, res) => {
    const p = versionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = decideVersionSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const outcome = await decideVersion(db, req.auth!, p.data.versionId, 'approve', b.data, req.requestId);
    const [status, message] = DECIDE_RESPONSES[outcome];
    res.status(status).json(status < 400 ? { status: outcome, message } : { error: message, reason: outcome });
  });

  r.post('/knowledge/versions/:versionId/reject', 'brand.approve', async (req, res) => {
    const p = versionParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = rejectVersionSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const outcome = await decideVersion(db, req.auth!, p.data.versionId, 'reject', b.data, req.requestId);
    const [status, message] = DECIDE_RESPONSES[outcome];
    res.status(status).json(status < 400 ? { status: outcome, message } : { error: message, reason: outcome });
  });

  r.post('/knowledge/:itemId/retire', 'brand.approve', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = retireItemSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const out = await retireItem(db, req.auth!, p.data.itemId, b.data.reason, req.requestId);
    if (out === 'not_found') res.status(404).json({ error: 'Not found.' });
    else if (out === 'already_retired') res.status(409).json({ error: 'Already retired.' });
    else res.json({ status: 'retired' });
  });

  r.post('/knowledge/:itemId/brand-core', 'brand.approve', async (req, res) => {
    const p = itemParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const b = setBrandCoreSchema.safeParse(req.body ?? {});
    if (!b.success) return badRequest(res, b.error);
    const out = await setBrandCore(db, req.auth!, p.data.itemId, b.data.inBrandCore, req.requestId);
    if (out === 'not_found') res.status(404).json({ error: 'Not found.' });
    else if (out === 'not_allowed') res.status(409).json({ error: 'Only brand rules and facts can be in the brand core.' });
    else if (out === 'core_too_large') res.status(409).json({ error: DECIDE_RESPONSES.core_too_large[1] });
    else res.json({ inBrandCore: b.data.inBrandCore });
  });
}
