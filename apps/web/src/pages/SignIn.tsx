import { useState, type FormEvent } from 'react';
import { ROLES, type Role } from '@the-pocket/shared';
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
    </AuthShell>
  );
}
