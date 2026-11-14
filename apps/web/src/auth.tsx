import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MeResponse, Role } from '@the-pocket/shared';

const MOCK_KEY = 'the-pocket-mock-role';

// Supabase invitation and password-reset links arrive with the type in the URL hash.
const arrivedViaInvite = typeof window !== 'undefined' && /type=(invite|recovery)/.test(window.location.hash);

export const supabase: SupabaseClient | null =
  __SUPABASE_URL__ && __SUPABASE_PUBLISHABLE_KEY__
    ? createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__)
    : null;

type Status = 'loading' | 'signed_out' | 'needs_password' | 'ready' | 'no_access' | 'error';

interface AuthState {
  status: Status;
  me: MeResponse | null;
  message: string | null;
  signIn(email: string, password: string): Promise<string | null>;
  signInMock(role: Role): void;
  setPassword(password: string): Promise<string | null>;
  signOut(): Promise<void>;
  apiFetch(path: string): Promise<Response>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

async function currentToken(): Promise<string | null> {
  if (__MOCK_AUTH__) {
    const role = sessionStorage.getItem(MOCK_KEY);
    if (role) return `mock:${role}`;
  }
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apiFetch = useCallback(async (path: string) => {
    const token = await currentToken();
    return fetch(`${__API_URL__}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }, []);

  const loadMe = useCallback(async () => {
    const token = await currentToken();
    if (!token) {
      setMe(null);
      setStatus('signed_out');
      return;
    }
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        setMe((await res.json()) as MeResponse);
        setStatus(arrivedViaInvite && !__MOCK_AUTH__ ? 'needs_password' : 'ready');
      } else if (res.status === 403) {
        setMe(null);
        setMessage((await res.json()).error as string);
        setStatus('no_access');
      } else {
        setMe(null);
        setStatus('signed_out');
      }
    } catch {
      setMessage('Cannot reach the server. Please try again in a moment.');
      setStatus('error');
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadMe();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void loadMe();
    });
    return () => data.subscription.unsubscribe();
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      message,
      async signIn(email, password) {
        if (!supabase) return 'Sign-in is not configured yet.';
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return 'That email and password did not match.';
        await loadMe();
        return null;
      },
      signInMock(role) {
        if (!__MOCK_AUTH__) return; // compiled out of production builds
        sessionStorage.setItem(MOCK_KEY, role);
        void loadMe();
      },
      async setPassword(password) {
        if (!supabase) return 'Sign-in is not configured yet.';
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return error.message;
        window.history.replaceState(null, '', window.location.pathname);
        window.location.reload();
        return null;
      },
      async signOut() {
        sessionStorage.removeItem(MOCK_KEY);
        if (supabase) await supabase.auth.signOut();
        setMe(null);
        setMessage(null);
        setStatus('signed_out');
      },
      apiFetch,
    }),
    [status, me, message, loadMe, apiFetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
