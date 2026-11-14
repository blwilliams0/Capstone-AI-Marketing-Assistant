import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { Alert, AuthShell, buttonClass, inputClass } from '../ui';

export function SetPassword() {
  const { setPassword, me } = useAuth();
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(await setPassword(password));
    setBusy(false);
  }

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-stone-200">
        <h2 className="text-lg font-medium">{me ? `Welcome, ${me.name}. Choose your password` : 'Choose your password'}</h2>
        <label className="block text-sm font-medium">
          New password (at least 12 characters)
          <input className={inputClass} type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Type it again
          <input className={inputClass} type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <Alert kind="error">{error}</Alert>}
        <button className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthShell>
  );
}
