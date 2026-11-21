import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { APPROVAL_EVENT_LABELS, type ActivityEntry } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card } from '../ui';
import { shortPrint } from './PostDetail';

const DOT: Record<string, string> = {
  submitted: 'bg-amber-500',
  approved: 'bg-green-600',
  self_approved: 'bg-green-600',
  posted: 'bg-sky-600',
  rejected: 'bg-red-600',
  changes_requested: 'bg-orange-500',
};

export function Activity() {
  const { apiFetch } = useAuth();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch('/api/activity');
      if (res.ok) setEntries(((await res.json()) as { activity: ActivityEntry[] }).activity);
      else setError(await readError(res));
    })();
  }, [apiFetch]);

  const byDay = new Map<string, ActivityEntry[]>();
  for (const e of entries ?? []) {
    const d = new Date(e.at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-stone-600">
          Who submitted, approved and posted what, and when. This history cannot be edited or deleted. Each entry shows the fingerprint of the exact text involved.
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {entries === null && !error && <p className="text-sm text-stone-500">Loading…</p>}
      {entries?.length === 0 && <p className="text-sm text-stone-500">No activity yet.</p>}
      {[...byDay.entries()].map(([day, list]) => (
        <Card key={day} title={day}>
          <ul className="space-y-2">
            {list.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.event] ?? 'bg-stone-400'}`} aria-hidden />
                <div>
                  <span className="text-stone-500">{new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span> ·{' '}
                  <span className="font-medium">{e.actor?.name ?? 'System'}</span> {APPROVAL_EVENT_LABELS[e.event] ?? e.event} ·{' '}
                  <Link to={`/posts/${e.itemId}`} className="underline">
                    {e.postTitle}
                  </Link>{' '}
                  <code className="text-xs text-stone-500">{shortPrint(e.digest)}</code>
                  {e.note && <p className="text-stone-600">“{e.note}”</p>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
