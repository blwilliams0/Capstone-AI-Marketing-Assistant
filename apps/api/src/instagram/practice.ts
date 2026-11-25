import type { Db } from '@the-pocket/db';
import { instagramMediaSchema, practiceInstagramActionSchema, type InstagramMedia, type PracticeInstagramConnection } from '@the-pocket/shared';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import type { PolicyRouter } from '../policy.js';

const disconnected: PracticeInstagramConnection = { state: 'disconnected', media: [], lastSyncedAt: null, lastError: null };
const fixtures = [
  { id: 'mock-patio', kind: 'photo', title: 'Fictional patio at dusk', publishedAt: '2026-10-03T18:00:00Z' },
  { id: 'mock-menu', kind: 'carousel', title: 'Fictional autumn menu carousel', publishedAt: '2026-10-02T18:00:00Z' },
  { id: 'mock-service', kind: 'reel', title: 'Fictional evening service Reel', publishedAt: '2026-10-01T18:00:00Z' },
];

export interface PublishedMediaReader {
  page(cursor?: string): Promise<unknown>;
}

const pageSchema = z.object({ items: z.array(instagramMediaSchema).max(30), next: z.string().min(1).max(1000).optional() });
export async function fetchPublishedMedia(reader: PublishedMediaReader) {
  const seen = new Map<string, InstagramMedia>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const { items, next } = pageSchema.parse(await reader.page(cursor));
    for (const entry of items) if (!seen.has(entry.id)) seen.set(entry.id, entry);
    if (!next) return [...seen.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 30);
    if (cursors.has(next)) throw new Error('Repeated Instagram cursor.');
    cursors.add(next);
    cursor = next;
  }
  throw new Error('Instagram page limit reached.');
}

function fixtureReader(changed: boolean): PublishedMediaReader {
  return {
    async page(cursor) {
      if (!cursor) return { items: [fixtures[0], fixtures[1]], next: 'second' };
      return { items: changed ? [fixtures[1]] : [fixtures[1], fixtures[2]] };
    },
  };
}

async function readConnection(db: Db, tenant: string) {
  const [row] = await db.query<PracticeInstagramConnection>(`SELECT state, media, last_synced_at AS "lastSyncedAt",
    last_error AS "lastError" FROM instagram_practice_connections WHERE restaurant_id = $1`, [tenant]);
  return row ?? disconnected;
}

export function addPracticeInstagramRoutes(router: PolicyRouter, db: Db, enabled: boolean) {
  router.get('/instagram/practice', 'content.draft', async (req, res) => {
    if (!enabled) return res.status(503).json({ error: 'The practice Instagram connector is unavailable.' });
    return res.json(await readConnection(db, req.auth!.restaurantId));
  });

  router.post('/instagram/practice', 'channel.connect', async (req, res) => {
    const input = practiceInstagramActionSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Choose a practice connector action.' });
    if (!enabled) return res.status(503).json({ error: 'The practice Instagram connector is unavailable.' });
    const actor = req.auth!;
    const action = input.data;
    const result = await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM restaurants WHERE id = $1 FOR UPDATE', [actor.restaurantId]);
      if (action.action === 'connect') {
        await tx.query(`INSERT INTO instagram_practice_connections (restaurant_id, state) VALUES ($1, 'connected')
          ON CONFLICT (restaurant_id) DO UPDATE SET state = 'connected', last_error = NULL`, [actor.restaurantId]);
      } else if (action.action === 'disconnect') {
        await tx.query('DELETE FROM instagram_practice_connections WHERE restaurant_id = $1', [actor.restaurantId]);
      } else if (action.action === 'sync') {
        const connection = await readConnection(tx, actor.restaurantId);
        if (connection.state === 'disconnected') return null;
        const issue = connection.state === 'expired' ? 'expired' : action.scenario;
        if (issue === 'normal' || issue === 'changed') {
          const media = await fetchPublishedMedia(fixtureReader(issue === 'changed'));
          await tx.query(`UPDATE instagram_practice_connections SET media = $2::jsonb, last_synced_at = now(), last_error = NULL
            WHERE restaurant_id = $1`, [actor.restaurantId, JSON.stringify(media)]);
        } else {
          await tx.query(`UPDATE instagram_practice_connections SET last_error = $2,
            state = CASE WHEN $2 = 'expired' THEN 'expired' ELSE state END WHERE restaurant_id = $1`, [actor.restaurantId, issue]);
        }
      }
      await recordAudit(tx, { restaurantId: actor.restaurantId, actorUserId: actor.userId, action: 'instagram.practice_' + action.action,
        targetType: 'restaurant', targetId: actor.restaurantId, requestId: req.requestId });
      return readConnection(tx, actor.restaurantId);
    });
    if (!result) return res.status(409).json({ error: 'Connect the fictional account before synchronizing.' });
    return res.json(result);
  });
}
