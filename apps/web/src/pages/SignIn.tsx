import { useState, type FormEvent } from 'react';
import { ROLES, ROLE_DESCRIPTIONS, type Role } from '@the-pocket/shared';
import { useAuth } from '../auth';
import { Alert, AuthShell, buttonClass, inputClass } from '../ui';

export function SignIn() {
  const { signIn, signInMock, sendResetLink, linkError } = useAuth();
  const [mode, setMode] = useState<'password' | 'reset'>(linkError ? 'reset' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === 'password') {
      setError(await signIn(email, password));
    } else {
      const problem = await sendResetLink(email);
      if (problem) setError(problem);
      else setSent(true);
    }
    setBusy(false);
  }

  if (__MOCK_AUTH__) {
    return (
      <AuthShell>
        <div className="rounded-lg border border-studio-linen bg-studio-cream p-4">
          <h2 className="mb-2 font-serif text-2xl font-semibold">Practice workspace</h2>
          <p className="mb-4 text-sm">Choose a local practice role. Use fictional test data.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((r: Role) => (
              <button key={r} type="button" onClick={() => signInMock(r)} className="rounded-md border border-studio-taupe bg-studio-pearl p-3 text-left text-sm hover:bg-studio-ivory">
                <strong className="block capitalize">{r === 'admin' ? 'Administrator' : r}</strong>
                <span className="mt-1 block text-xs text-studio-muted">{ROLE_DESCRIPTIONS[r]}</span>
              </button>
            ))}
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-stone-200">
        <h2 className="text-lg font-medium">{mode === 'password' ? 'Sign in' : 'Get a sign-in link'}</h2>
        {linkError && <Alert kind="error">{linkError}</Alert>}
        <label className="block text-sm font-medium">
          Email
          <input className={inputClass} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'password' && (
          <label className="block text-sm font-medium">
            Password
            <input className={inputClass} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {sent && mode === 'reset' && (
          <Alert kind="success">
            If that email has access, a link is on its way. Open it on this computer to choose a new password. It can take a few minutes; check spam too.
          </Alert>
        )}
        <button className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
        </button>
        <button
          type="button"
          className="text-sm text-stone-700 underline"
          onClick={() => {
            setMode(mode === 'password' ? 'reset' : 'password');
            setError(null);
            setSent(false);
          }}
        >
          {mode === 'password' ? 'Forgot your password, or your invitation link stopped working?' : 'Back to sign in with a password'}
        </button>
        <p className="text-sm text-stone-600">New here? Use the link in your invitation email to choose your password.</p>
      </form>
    </AuthShell>
  );
}
