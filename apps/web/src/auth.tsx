import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MeResponse, Role } from '@the-pocket/shared';

const MOCK_KEY = 'the-pocket-mock-role';

/** Reads Supabase's auth parameters from the URL once, before supabase-js clears them. */
function readAuthUrl(): { linkType: string | null; error: string | null } {
  if (typeof window === 'undefined') return { linkType: null, error: null };
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  for (const [k, v] of new URLSearchParams(window.location.search)) if (!params.has(k)) params.set(k, v);
  const code = params.get('error_code');
  const description = params.get('error_description');
  let error: string | null = null;
  if (code || params.get('error')) {
    error =
      code === 'otp_expired'
        ? 'That link has expired or was already used. Enter your email below and choose "Email me a sign-in link" to get a new one.'
        : `Sign-in link problem: ${description ?? code ?? 'unknown error'}. Request a new link below.`;
  }
  return { linkType: params.get('type'), error };
}

const authUrl = readAuthUrl();
// Invitation and password-reset links both mean "this person must choose a password now".
const arrivedToSetPassword = authUrl.linkType === 'invite' || authUrl.linkType === 'recovery';

export const supabase: SupabaseClient | null =
  __SUPABASE_URL__ && __SUPABASE_PUBLISHABLE_KEY__
    ? createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__)
    : null;

type Status = 'loading' | 'signed_out' | 'needs_password' | 'ready' | 'no_access' | 'error';

type ApiOptions = { method?: string; body?: unknown; headers?: Record<string, string> };

interface AuthState {
  status: Status;
  me: MeResponse | null;
  message: string | null;
  /** A problem reported by Supabase in the link the user followed (expired, already used, ...). */
  linkError: string | null;
  signIn(email: string, password: string): Promise<string | null>;
  signInMock(role: Role): void;
  /** Sends a password-reset email. Always reports success so it cannot reveal who has an account. */
  sendResetLink(email: string): Promise<string | null>;
  setPassword(password: string): Promise<string | null>;
  signOut(): Promise<void>;
  apiFetch(path: string, init?: ApiOptions): Promise<Response>;
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
  // A ref, not state: loadMe must always see the current value, not the one from its closure.
  const needsPassword = useRef(arrivedToSetPassword && !__MOCK_AUTH__);
  const meRef = useRef<MeResponse | null>(null);

  const apiFetch = useCallback(async (path: string, init?: ApiOptions) => {
    const token = await currentToken();
    const headers: Record<string, string> = { ...init?.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = init?.body;
    if (body !== undefined) headers['Content-Type'] = body instanceof Blob ? body.type : 'application/json';
    try {
      return await fetch(`${__API_URL__}${path}`, {
        method: init?.method ?? 'GET',
        headers,
        body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Network failure (server stopped, Wi-Fi dropped): answer like an error response, so every
      // page shows a message instead of a button stuck on "Saving…".
      return new Response(JSON.stringify({ error: 'Cannot reach the server. Check the connection and try again.', reason: 'network' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }, []);

  const loadMe = useCallback(async () => {
    const token = await currentToken();
    if (!token) {
      setMe(null);
      meRef.current = null;
      setStatus('signed_out');
      return;
    }
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const loaded = (await res.json()) as MeResponse;
        meRef.current = loaded;
        setMe(loaded);
        setStatus(needsPassword.current ? 'needs_password' : 'ready');
      } else if (res.status === 403) {
        setMe(null);
        meRef.current = null;
        setMessage(((await res.json()) as { error: string }).error);
        setStatus('no_access');
      } else if (res.status === 401) {
        setMe(null);
        meRef.current = null;
        setStatus('signed_out');
      } else if (!meRef.current) {
        // A passing problem (busy server, too many requests) before the first load.
        setMessage('Cannot reach the server right now. Please try again in a moment.');
        setStatus('error');
      }
      // Otherwise keep the current session: a passing problem must not sign people out or lose edits.
    } catch {
      if (meRef.current) return;
      setMessage('Cannot reach the server. Please try again in a moment.');
      setStatus('error');
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadMe();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') needsPassword.current = true;
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY') void loadMe();
    });
    return () => data.subscription.unsubscribe();
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      message,
      linkError: authUrl.error,
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
      async sendResetLink(email) {
        if (!supabase) return 'Sign-in is not configured yet.';
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        // Rate-limit errors are worth showing; anything else is hidden so the form cannot
        // be used to discover which email addresses have accounts.
        if (error && /rate limit|too many/i.test(error.message)) {
          return 'Too many emails were requested. Please wait a few minutes and try again.';
        }
        return null;
      },
      async setPassword(password) {
        if (!supabase) return 'Sign-in is not configured yet.';
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return error.message;
        needsPassword.current = false;
        window.history.replaceState(null, '', window.location.pathname);
        await loadMe();
        return null;
      },
      async signOut() {
        sessionStorage.removeItem(MOCK_KEY);
        if (supabase) await supabase.auth.signOut();
        setMe(null);
        meRef.current = null;
        setMessage(null);
        setStatus('signed_out');
      },
      apiFetch,
    }),
    [status, me, message, loadMe, apiFetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Reads a JSON error body from the API in a consistent, user-friendly way. */
export async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; problems?: { field: string; message: string }[] };
    if (body.problems?.length) return `${body.error ?? 'Invalid input.'} ${body.problems.map((p) => `${p.field}: ${p.message}`).join('; ')}`;
    return body.error ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}
