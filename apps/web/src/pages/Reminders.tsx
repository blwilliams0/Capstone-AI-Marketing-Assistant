import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { NotificationsResponse } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, secondaryButtonClass } from '../ui';

export function Reminders() {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/notifications');
    if (res.ok) setData((await res.json()) as NotificationsResponse);
    else setError(await readError(res));
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST', body: {} });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reminders</h1>
          <p className="text-sm text-stone-600">Posts due or overdue, approvals waiting, and facts about to expire. Checked automatically every few minutes.</p>
        </div>
        {data && data.unread > 0 && (
          <button
            className={secondaryButtonClass}
            onClick={async () => {
              await apiFetch('/api/notifications/read-all', { method: 'POST', body: {} });
              await load();
            }}
          >
            Mark all as read
          </button>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {data === null && !error && <p className="text-sm text-stone-500">Loading…</p>}
        {data?.notifications.length === 0 && <p className="text-sm text-stone-500">Nothing needs your attention.</p>}
        <ul className="divide-y divide-stone-200">
          {data?.notifications.map((n) => (
            <li key={n.id} className={`flex items-start justify-between gap-3 py-3 ${n.read ? 'opacity-60' : ''}`}>
              <div>
                <Link to={n.link} className="font-medium underline" onClick={() => void markRead(n.id)}>
                  {n.title}
                </Link>
                <p className="text-sm text-stone-600">{n.body}</p>
                <p className="text-xs text-stone-500">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              {!n.read && (
                <button className="shrink-0 text-xs text-stone-600 underline" onClick={() => void markRead(n.id)}>
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
