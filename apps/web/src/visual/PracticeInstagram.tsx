import { useEffect, useState } from 'react';
import type { PracticeInstagramConnection } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, inputClass, secondaryButtonClass } from '../ui';

const issues = {
  expired: 'The fictional account expired. Reconnect to refresh.',
  rate_limited: 'The simulated provider rate-limited this refresh. The last successful results are preserved.',
  unavailable: 'The simulated provider is unavailable. The last successful results are preserved.',
};

export function PracticeInstagram() {
  const { apiFetch, me } = useAuth();
  const [connection, setConnection] = useState<PracticeInstagramConnection>();
  const [scenario, setScenario] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void apiFetch('/api/instagram/practice').then(async (res) => {
      if (!res.ok) throw new Error(await readError(res));
      const value = await res.json() as PracticeInstagramConnection;
      if (active) setConnection(value);
    }).catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [apiFetch]);
  async function run(action: 'connect' | 'disconnect' | 'sync') {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/instagram/practice', { method: 'POST', body: { action, scenario } });
      if (!res.ok) throw new Error(await readError(res));
      setConnection(await res.json() as PracticeInstagramConnection);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Card title="Fictional Instagram account">
    <p className="text-sm text-studio-muted">Practice account and published media metadata. The preview stays local.</p>
    {error && <Alert kind="error">{error}</Alert>}
    {connection && <>
      <p className="mt-2 text-sm capitalize" role="status">{connection.state}</p>
      {connection.lastSyncedAt && <p className="text-sm">Last successful refresh {new Date(connection.lastSyncedAt).toLocaleString()}</p>}
      {connection.lastError && <Alert kind="info">{issues[connection.lastError]}</Alert>}
      {me?.capabilities.includes('channel.connect') && <div className="my-2 flex flex-wrap items-end gap-2">
        {connection.state !== 'connected' && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run('connect')}>
          {connection.state === 'expired' ? 'Reconnect fictional account' : 'Connect fictional account'}
        </button>}
        {connection.state === 'connected' && <>
          <label className="text-sm">Practice refresh scenario<select className={inputClass} value={scenario} onChange={(event) => setScenario(event.target.value)}>
            <option value="normal">Successful refresh</option><option value="changed">One item removed</option><option value="expired">Expired account</option>
            <option value="rate_limited">Rate limit</option><option value="unavailable">Provider unavailable</option>
          </select></label>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run('sync')}>Refresh fictional media</button>
        </>}
        {connection.state !== 'disconnected' && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run('disconnect')}>Disconnect</button>}
      </div>}
      {connection.media.length > 0 && <ul className="grid gap-2 sm:grid-cols-3">
        {connection.media.map((item) => <li key={item.id} className="rounded-md border border-studio-linen bg-studio-cream p-3 text-sm">
          <p className="font-semibold">{item.title}</p>
          <p className="capitalize text-studio-muted">{item.kind} · {new Date(item.publishedAt).toLocaleDateString()}</p>
        </li>)}
      </ul>}
    </>}
  </Card>;
}
