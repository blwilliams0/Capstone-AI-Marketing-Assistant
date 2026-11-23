import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createPgDb } from '@the-pocket/db';
import { capabilitiesFor, isRole, knowledgeKindSchema } from '@the-pocket/shared';
import { recordAudit } from '../audit.js';
import { createItem, proposeVersion } from '../knowledge/service.js';

/**
 * Loads a document into the knowledge library AS A PROPOSAL. It is never approved by this script;
 * an administrator must approve it in the app before the assistant uses it.
 *
 *   npm run load-knowledge -w @the-pocket/api -- --file docs/strategy/MARKETING_STRATEGY.md \
 *     --kind strategy --title "Marketing strategy (team draft)" --as-first-admin
 */
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    kind: { type: 'string' },
    title: { type: 'string' },
    source: { type: 'string' },
    'as-email': { type: 'string' },
    'as-first-admin': { type: 'boolean', default: false },
    update: { type: 'boolean', default: false },
  },
});

const url = process.env.DATABASE_URL;
const kind = knowledgeKindSchema.safeParse(values.kind);
if (!url || !values.file || !values.title || !kind.success || (!values['as-email'] && !values['as-first-admin'])) {
  console.error(
    'Usage: --file <path> --kind <brand_rule|fact|strategy|reference> --title "<title>" (--as-email <email> | --as-first-admin) [--source "<note>"] [--update]\n--update proposes a new version when the title already exists and the text changed.\nRequires DATABASE_URL.',
  );
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const body = (await readFile(path.resolve(repoRoot, values.file), 'utf8')).trim();
const db = createPgDb(url);
try {
  const [actor] = await db.query<{ user_id: string; email: string; name: string; restaurant_id: string; id: string; role: string }>(
    values['as-email']
      ? `SELECT m.user_id, p.email, p.name, m.restaurant_id, m.id, m.role FROM memberships m JOIN profiles p ON p.user_id = m.user_id
          WHERE lower(p.email) = lower($1) AND m.status <> 'revoked' ORDER BY m.created_at LIMIT 1`
      : `SELECT m.user_id, p.email, p.name, m.restaurant_id, m.id, m.role FROM memberships m JOIN profiles p ON p.user_id = m.user_id
          WHERE m.role = 'admin' AND m.status <> 'revoked' ORDER BY m.created_at LIMIT 1`,
    values['as-email'] ? [values['as-email']] : [],
  );
  if (!actor || !isRole(actor.role)) {
    console.error('No matching member found to record as the proposer.');
    process.exit(1);
  }

  const authCtx = {
    userId: actor.user_id,
    email: actor.email,
    name: actor.name,
    restaurantId: actor.restaurant_id,
    membershipId: actor.id,
    role: actor.role,
    capabilities: capabilitiesFor(actor.role),
  };
  const sourceNote =
    values.source ?? `Loaded from ${values.file} by setup script on ${new Date().toISOString().slice(0, 10)}. Pending management approval.`;
  const [existing] = await db.query<{ id: string; latest: string | null }>(
    `SELECT i.id, (SELECT v.body FROM knowledge_versions v WHERE v.item_id = i.id ORDER BY v.version DESC LIMIT 1) AS latest
       FROM knowledge_items i WHERE i.restaurant_id = $1 AND i.kind = $2 AND i.title = $3`,
    [actor.restaurant_id, kind.data, values.title],
  );
  if (existing && (!values.update || existing.latest?.trim() === body)) {
    console.log(`Already loaded: "${values.title}". Nothing changed.${values.update ? '' : ' Use --update to propose a new version.'}`);
  } else if (existing) {
    const out = await proposeVersion(db, authCtx, existing.id, { body, sourceNote });
    if (typeof out === 'string') {
      console.error(`Could not add a new version: ${out}.`);
      process.exit(1);
    }
    await recordAudit(db, {
      restaurantId: actor.restaurant_id,
      actorUserId: actor.user_id,
      action: 'knowledge.loaded_by_script',
      targetType: 'knowledge_version',
      targetId: out.versionId,
      details: { file: values.file, note: 'New version proposed by the load-knowledge setup script, not by a click in the app.' },
    });
    console.log(`Proposed version ${out.version} of "${values.title}" (${body.length.toLocaleString()} characters). An administrator must approve it in the app.`);
  } else {
    const out = await createItem(db, authCtx, { kind: kind.data, title: values.title, body, sourceNote });
    await recordAudit(db, {
      restaurantId: actor.restaurant_id,
      actorUserId: actor.user_id,
      action: 'knowledge.loaded_by_script',
      targetType: 'knowledge_version',
      targetId: out.versionId,
      details: { file: values.file, note: 'Proposal created by the load-knowledge setup script, not by a click in the app.' },
    });
    console.log(`Loaded "${values.title}" as a proposal (${body.length.toLocaleString()} characters). An administrator must approve it in the app.`);
  }
} finally {
  await db.close();
}
