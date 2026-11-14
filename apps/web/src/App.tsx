import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ROLE_DESCRIPTIONS, ROLES, type Role } from '@the-pocket/shared';
import { useAuth } from './auth';

const CAPABILITY_LABELS: Record<string, string> = {
  'knowledge.view': 'Read approved marketing material',
  'analytics.view': 'See marketing reports',
  'content.draft': 'Draft marketing content',
  'approval.request': 'Submit drafts for review',
  'data.import': 'Import sales and reservation reports',
  'post.approve': 'Approve marketing posts',
  'brand.approve': 'Approve brand rules',
  'channel.connect': 'Connect social media accounts',
  'users.invite': 'Invite staff',
  'users.manage': 'Change or remove staff access',
  'data.export': 'Export data',
  'analytics.view_sensitive': 'See sensitive reports',
  'audit.view': 'See the activity history',
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="mb-8 text-2xl font-semibold">The Pocket Marketing Assistant</h1>
        {children}
      </div>
    </div>
  );
}

const inputClass = 'mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2';
const buttonClass =
  'w-full rounded-md bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 disabled:opacity-50';

function SignIn() {
  const { signIn, signInMock } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-medium">Sign in</h2>
        <label className="block text-sm font-medium">
          Email
          <input className={inputClass} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input className={inputClass} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className={buttonClass} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-sm text-stone-600">New here? Use the link in your invitation email to set your password.</p>
      </form>
      {__MOCK_AUTH__ && (
        <div className="mt-6 rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-medium text-amber-900">Developer mock sign-in (local development only)</p>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r: Role) => (
              <button key={r} type="button" onClick={() => signInMock(r)} className="rounded border border-amber-600 px-3 py-1 text-sm">
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

function SetPassword() {
  const { setPassword } = useAuth();
  const [password, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(await setPassword(password));
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-medium">Welcome! Choose your password</h2>
        <label className="block text-sm font-medium">
          New password (at least 12 characters)
          <input className={inputClass} type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPw(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className={buttonClass}>Save password</button>
      </form>
    </Shell>
  );
}

function Home() {
  const { me, signOut, apiFetch } = useAuth();
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');

  useEffect(() => {
    apiFetch('/health')
      .then((r) => setHealth(r.ok ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
  }, [apiFetch]);

  if (!me) return null;
  return (
    <Shell>
      <div className="space-y-6 rounded-lg bg-white p-6 shadow">
        <div>
          <p className="text-lg font-medium">Hello, {me.name}</p>
          <p className="text-sm text-stone-600">{me.email}</p>
        </div>
        <div>
          <p className="font-medium">Your access: {me.role}</p>
          <p className="text-sm text-stone-600">{ROLE_DESCRIPTIONS[me.role]}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {me.capabilities.map((c) => (
              <li key={c}>{CAPABILITY_LABELS[c] ?? c}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">This list is for information. The server checks your permissions on every action.</p>
        </div>
        <p className="text-sm">
          Server status:{' '}
          <span className={health === 'ok' ? 'text-green-700' : health === 'down' ? 'text-red-700' : 'text-stone-500'}>
            {health === 'ok' ? 'connected' : health === 'down' ? 'not reachable' : 'checking…'}
          </span>
        </p>
        <button onClick={() => void signOut()} className="rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100">
          Sign out
        </button>
      </div>
    </Shell>
  );
}

export default function App() {
  const { status, message, signOut } = useAuth();
  switch (status) {
    case 'loading':
      return <Shell><p>Loading…</p></Shell>;
    case 'signed_out':
      return <SignIn />;
    case 'needs_password':
      return <SetPassword />;
    case 'no_access':
    case 'error':
      return (
        <Shell>
          <div className="space-y-4 rounded-lg bg-white p-6 shadow">
            <p role="alert">{message ?? 'Something went wrong.'}</p>
            <button onClick={() => void signOut()} className="rounded-md border border-stone-300 px-4 py-2 text-sm">Sign out</button>
          </div>
        </Shell>
      );
    case 'ready':
      return <Home />;
  }
}
