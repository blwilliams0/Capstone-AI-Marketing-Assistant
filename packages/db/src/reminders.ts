import type { Db } from './types.js';

/** The restaurant's local time zone, for reminder wording. */
export const RESTAURANT_TIME_ZONE = 'America/Los_Angeles';

/** Active staff who may post (admins, approvers, contributors), or only the given roles. */
const STAFF = (roles: string) => `
  SELECT m.user_id FROM memberships m WHERE m.restaurant_id = $1 AND m.status = 'active' AND m.role = ANY('${roles}'::text[])`;

const when = (col: string) => `to_char(${col} AT TIME ZONE '${RESTAURANT_TIME_ZONE}', 'Dy Mon FMDD, FMHH12:MI AM')`;

/**
 * Creates any reminders that are due for one restaurant, as of `now`. Safe to run any number of
 * times, from any process: each reminder has a dedupe key per recipient, so it is created once.
 * Returns how many new reminders were created.
 */
export async function runReminderScan(db: Db, restaurantId: string, now: Date = new Date()): Promise<number> {
  const at = now.toISOString();
  const statements: string[] = [
    // Approved, not posted, scheduled within the next 24 hours: time to post.
    `INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key)
     SELECT $1, s.user_id, 'post_due', left('Time to post: ' || i.title, 200),
            'Approved and scheduled for ' || ${when('v.scheduled_for')} || '. Copy the approved text from Ready to post.',
            '/ready', 'post_due:' || a.id
       FROM approval_requests a
       JOIN content_versions v ON v.id = a.content_version_id
       JOIN content_items i ON i.id = a.item_id AND i.archived_at IS NULL
       CROSS JOIN (${STAFF('{admin,approver,contributor}')}) s
      WHERE a.restaurant_id = $1 AND a.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM post_records r WHERE r.approval_id = a.id)
        AND v.scheduled_for > $2::timestamptz AND v.scheduled_for <= $2::timestamptz + interval '24 hours'
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,

    // Approved, scheduled more than 2 hours ago, still not recorded as posted.
    `INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key)
     SELECT $1, s.user_id, 'post_overdue', left('Not posted yet: ' || i.title, 200),
            'It was scheduled for ' || ${when('v.scheduled_for')} || '. Post it now, or edit the date (it will need approving again).',
            '/ready', 'post_overdue:' || a.id
       FROM approval_requests a
       JOIN content_versions v ON v.id = a.content_version_id
       JOIN content_items i ON i.id = a.item_id AND i.archived_at IS NULL
       CROSS JOIN (${STAFF('{admin,approver,contributor}')}) s
      WHERE a.restaurant_id = $1 AND a.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM post_records r WHERE r.approval_id = a.id)
        AND v.scheduled_for <= $2::timestamptz - interval '2 hours'
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,

    // Scheduled within 48 hours but not yet submitted for approval: remind whoever started it.
    `INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key)
     SELECT $1, i.created_by, 'post_not_submitted', left('Needs approval soon: ' || i.title, 200),
            'Scheduled for ' || ${when('v.scheduled_for')} || ' but not submitted for approval yet.',
            '/posts/' || i.id, 'post_not_submitted:' || v.id
       FROM content_items i
       JOIN LATERAL (SELECT * FROM content_versions cv WHERE cv.item_id = i.id ORDER BY cv.version DESC LIMIT 1) v ON true
      WHERE i.restaurant_id = $1 AND i.archived_at IS NULL
        AND v.scheduled_for > $2::timestamptz AND v.scheduled_for <= $2::timestamptz + interval '48 hours'
        AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.content_version_id = v.id AND a.status IN ('pending', 'approved'))
        AND NOT EXISTS (SELECT 1 FROM post_records r WHERE r.item_id = i.id)
        AND i.created_by IN (${STAFF('{admin,approver,contributor}')})
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,

    // Waiting for a decision for more than a day: remind reviewers (not the person who asked).
    `INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key)
     SELECT $1, s.user_id, 'approval_waiting', left('Waiting for approval: ' || i.title, 200),
            'Submitted ' || ${when('a.requested_at')} || ' and still waiting for a decision.',
            '/posts/' || i.id, 'approval_waiting:' || a.id
       FROM approval_requests a
       JOIN content_items i ON i.id = a.item_id AND i.archived_at IS NULL
       CROSS JOIN (${STAFF('{admin,approver}')}) s
      WHERE a.restaurant_id = $1 AND a.status = 'pending' AND a.requested_at <= $2::timestamptz - interval '24 hours'
        AND s.user_id <> a.requested_by
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,

    // Approved facts that expire within 7 days: ask administrators to re-check them.
    `INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key)
     SELECT $1, s.user_id, 'fact_expiring', left('Fact expiring soon: ' || ki.title, 200),
            'Stops being used ' || ${when('kv.expires_at')} || '. If it is still true, propose an updated version with a new date.',
            '/knowledge', 'fact_expiring:' || kv.id
       FROM knowledge_versions kv
       JOIN knowledge_items ki ON ki.id = kv.item_id AND ki.retired_at IS NULL
       CROSS JOIN (${STAFF('{admin}')}) s
      WHERE kv.restaurant_id = $1 AND kv.status = 'approved'
        AND kv.expires_at > $2::timestamptz AND kv.expires_at <= $2::timestamptz + interval '7 days'
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,

    // Facts that expired in the last 30 days (older ones are not re-announced).
    `INSERT INTO notifications (restaurant_id, recipient_user_id, kind, title, body, link, dedupe_key)
     SELECT $1, s.user_id, 'fact_expired', left('Fact expired: ' || ki.title, 200),
            'The assistant stopped using it on ' || ${when('kv.expires_at')} || '. Posts relying on it are blocked until updated.',
            '/knowledge', 'fact_expired:' || kv.id
       FROM knowledge_versions kv
       JOIN knowledge_items ki ON ki.id = kv.item_id AND ki.retired_at IS NULL
       CROSS JOIN (${STAFF('{admin}')}) s
      WHERE kv.restaurant_id = $1 AND kv.status = 'approved'
        AND kv.expires_at <= $2::timestamptz AND kv.expires_at > $2::timestamptz - interval '30 days'
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING`,
  ];

  let created = 0;
  for (const sql of statements) {
    const rows = await db.query(`${sql} RETURNING id`, [restaurantId, at]);
    created += rows.length;
  }
  return created;
}
