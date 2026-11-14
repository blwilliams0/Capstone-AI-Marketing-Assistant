import { createClient } from '@supabase/supabase-js';

/** Server-side Supabase Auth administration (invitations). Needs the secret key; never used in the browser. */
export interface AuthAdmin {
  inviteUserByEmail(email: string, name: string): Promise<{ userId: string }>;
}

export class InviteError extends Error {}

export function createSupabaseAuthAdmin(opts: {
  supabaseUrl: string;
  secretKey: string;
  redirectTo: string;
}): AuthAdmin {
  const client = createClient(opts.supabaseUrl, opts.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async inviteUserByEmail(email, name) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo: opts.redirectTo,
        data: { name },
      });
      if (error || !data.user) {
        throw new InviteError(error?.message ?? 'Invitation failed');
      }
      return { userId: data.user.id };
    },
  };
}
