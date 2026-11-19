import { z } from 'zod';
import { runReminderScan, type Db } from '@the-pocket/db';
import { calendarQuerySchema, type CalendarResponse, type NotificationView, type NotificationsResponse } from '@the-pocket/shared';
import { listPosts } from '../content/service.js';
import { badRequest } from '../knowledge/routes.js';
import type { PolicyRouter } from '../policy.js';

const idParam = z.object({ notificationId: z.string().uuid() });

/** At most one reminder scan per restaurant per 10 minutes from the API (the worker also scans). */
const SCAN_EVERY_MS = 10 * 60 * 1000;

export function addCalendarRoutes(r: PolicyRouter, db: Db) {
  const lastScan = new Map<string, number>();

  async function maybeScan(restaurantId: string) {
    const now = Date.now();
    if (now - (lastScan.get(restaurantId) ?? 0) < SCAN_EVERY_MS) return;
    lastScan.set(restaurantId, now);
    try {
      await runReminderScan(db, restaurantId);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'reminder scan failed', error: err instanceof Error ? err.message : String(err) }));
    }
  }

  r.get('/notifications', 'member', async (req, res) => {
    const a = req.auth!;
    await maybeScan(a.restaurantId);
    const rows = await db.query<{ id: string; kind: NotificationView['kind']; title: string; body: string; link: string; created_at: Date | string; read_at: unknown }>(
      `SELECT id, kind, title, body, link, created_at, read_at FROM notifications
        WHERE recipient_user_id = $1 AND restaurant_id = $2
        ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT 50`,
      [a.userId, a.restaurantId],
    );
    const [{ n }] = (await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND restaurant_id = $2 AND read_at IS NULL`,
      [a.userId, a.restaurantId],
    )) as [{ n: number }];
    const out: NotificationsResponse = {
      notifications: rows.map((x) => ({ id: x.id, kind: x.kind, title: x.title, body: x.body, link: x.link, createdAt: new Date(x.created_at).toISOString(), read: x.read_at !== null })),
      unread: n,
    };
    res.json(out);
  });

  r.post('/notifications/:notificationId/read', 'member', async (req, res) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return badRequest(res, p.error);
    const a = req.auth!;
    await db.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND recipient_user_id = $2 AND restaurant_id = $3 AND read_at IS NULL`, [
      p.data.notificationId,
      a.userId,
      a.restaurantId,
    ]);
    res.json({ status: 'read' });
  });

  r.post('/notifications/read-all', 'member', async (req, res) => {
    const a = req.auth!;
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1 AND restaurant_id = $2 AND read_at IS NULL`, [a.userId, a.restaurantId]);
    res.json({ status: 'read' });
  });

  r.get('/calendar', 'content.view', async (req, res) => {
    const q = calendarQuerySchema.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    const a = req.auth!;
    // Inclusive day range, widened by a day each side so local-time days are fully covered.
    const from = new Date(`${q.data.from}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(`${q.data.to}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 2);

    const posts = await listPosts(db, a.restaurantId);
    const scheduled = await db.query<{ item_id: string; scheduled_for: Date | string | null }>(
      `SELECT DISTINCT ON (item_id) item_id, scheduled_for FROM content_versions
        WHERE restaurant_id = $1 ORDER BY item_id, version DESC`,
      [a.restaurantId],
    );
    const when = new Map(scheduled.map((s) => [s.item_id, s.scheduled_for]));
    const facts = await db.query<{ item_id: string; title: string; expires_at: Date | string }>(
      `SELECT ki.id AS item_id, ki.title, kv.expires_at FROM knowledge_versions kv JOIN knowledge_items ki ON ki.id = kv.item_id AND ki.retired_at IS NULL
        WHERE kv.restaurant_id = $1 AND kv.status = 'approved' AND kv.expires_at >= $2 AND kv.expires_at < $3 ORDER BY kv.expires_at`,
      [a.restaurantId, from.toISOString(), to.toISOString()],
    );

    const out: CalendarResponse = { posts: [], facts: facts.map((f) => ({ itemId: f.item_id, title: f.title, expiresAt: new Date(f.expires_at).toISOString() })), unscheduled: [] };
    for (const p of posts) {
      const s = when.get(p.id);
      if (!s) {
        if (p.status !== 'posted') out.unscheduled.push({ itemId: p.id, title: p.title, status: p.status });
        continue;
      }
      const t = new Date(s);
      if (t >= from && t < to) out.posts.push({ itemId: p.id, title: p.title, status: p.status, channel: p.channel, scheduledFor: t.toISOString() });
    }
    out.posts.sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor));
    res.json(out);
  });
}
