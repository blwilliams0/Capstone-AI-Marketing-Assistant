import { parseArgs } from 'node:util';
import { createPgDb } from '@the-pocket/db';
import { recordAudit } from '../audit.js';
import { createSupabaseAuthAdmin } from '../auth/auth-admin.js';

/**
 * One-time setup: creates the restaurant (if missing) and invites its first administrator through
 * Supabase Auth. No accounts are hardcoded; the owner chooses the email addresses.
 */
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    restaurant: { type: 'string', default: 'The Pocket' },
  },
});

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, WEB_ORIGIN } = process.env;
if (!values.email || !values.name || !DATABASE_URL || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    'Usage: npm run bootstrap-admin -- --email you@example.com --name "Full Name" [--restaurant "The Pocket"]\n' +
      'Requires DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.',
  );
  process.exit(1);
}

const email = values.email.trim().toLowerCase();
const db = createPgDb(DATABASE_URL);
try {
  const authAdmin = createSupabaseAuthAdmin({
    supabaseUrl: SUPABASE_URL,
    secretKey: SUPABASE_SECRET_KEY,
    redirectTo: WEB_ORIGIN ?? 'http://localhost:5173',
  });

  const [existing] = await db.query<{ id: string }>('SELECT id FROM restaurants WHERE name = $1', [
    values.restaurant,
  ]);
  const restaurantId =
    existing?.id ??
    (await db.query<{ id: string }>('INSERT INTO restaurants (name) VALUES ($1) RETURNING id', [values.restaurant]))[0]!.id;

  const { userId } = await authAdmin.inviteUserByEmail(email, values.name);

  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`, [
      userId,
      email,
      values.name,
    ]);
    const [m] = await tx.query<{ id: string }>(
      `INSERT INTO memberships (restaurant_id, user_id, role, status, invited_by)
       VALUES ($1, $2, 'admin', 'invited', NULL) RETURNING id`,
      [restaurantId, userId],
    );
    await tx.query(
      `INSERT INTO permission_events (restaurant_id, membership_id, actor_user_id, event, new_role, reason)
       VALUES ($1, $2, $3, 'invited', 'admin', 'bootstrap')`,
      [restaurantId, m!.id, userId],
    );
    await recordAudit(tx, {
      restaurantId,
      actorUserId: userId,
      action: 'member.bootstrap_admin_invited',
      targetType: 'membership',
      targetId: m!.id,
      details: { email },
    });
  });
  console.log(`Invitation sent to ${email}. Open the email link to set a password, then sign in.`);
} finally {
  await db.close();
}
