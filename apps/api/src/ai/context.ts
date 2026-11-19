import type { Db } from '@the-pocket/db';
import { getBrandCore, searchSections } from '../knowledge/service.js';
import type { AiDocument } from './provider.js';

/** Rough token estimate (about 4 characters per token for English). Used only for budgeting context. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface ContextLimits {
  /** Maximum number of retrieved sections. */
  maxSections: number;
  /** Token budget for retrieved sections (the brand core has its own word cap). */
  sectionTokenBudget: number;
}

export const DEFAULT_LIMITS: ContextLimits = { maxSections: 8, sectionTokenBudget: 6000 };

/** The brand core only (approved, current brand rules and facts), keyed D1, D2... in a stable order. */
export async function brandCoreDocuments(db: Db, restaurantId: string): Promise<AiDocument[]> {
  const core = await getBrandCore(db, restaurantId);
  return core.entries.map((e, i) => ({
    key: `D${i + 1}`,
    title: e.title,
    text: e.sourceNote ? `${e.body}\n\n(Source: ${e.sourceNote})` : e.body,
    versionId: e.versionId,
    kind: e.kind,
    core: true,
  }));
}

/**
 * Builds the documents for one AI request:
 * 1. the brand core (approved, current brand rules and facts) - always, first, in a stable order;
 * 2. the most relevant approved sections for this question, until the token budget is used.
 * Nothing unapproved, expired, retired or from another restaurant can appear: both sources filter
 * in SQL. Keys D1, D2, ... are assigned here; the model only ever sees keys, never database IDs.
 */
export async function buildContext(
  db: Db,
  restaurantId: string,
  query: string,
  limits: ContextLimits = DEFAULT_LIMITS,
): Promise<AiDocument[]> {
  const docs = await brandCoreDocuments(db, restaurantId);
  const coreVersions = new Set(docs.map((d) => d.versionId));
  const hits = await searchSections(db, restaurantId, query, limits.maxSections * 2);
  let used = 0;
  let added = 0;
  for (const h of hits) {
    if (added >= limits.maxSections) break;
    if (coreVersions.has(h.versionId)) continue; // already included in full
    const tokens = estimateTokens(h.body);
    if (used + tokens > limits.sectionTokenBudget) continue;
    used += tokens;
    added += 1;
    docs.push({
      key: `D${docs.length + 1}`,
      title: `${h.title} — ${h.heading}`,
      text: h.body,
      versionId: h.versionId,
      kind: h.kind,
      core: false,
    });
  }
  return docs;
}
