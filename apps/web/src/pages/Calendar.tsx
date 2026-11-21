import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CHANNEL_LABELS, POST_STATUS_LABELS, type CalendarResponse } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, secondaryButtonClass } from '../ui';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-stone-400',
  in_review: 'bg-amber-500',
  changes_requested: 'bg-orange-500',
  rejected: 'bg-red-600',
  approved: 'bg-green-600',
  posted: 'bg-sky-600',
};

export function Calendar() {
  const { apiFetch } = useAuth();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Whole weeks covering the month.
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - start.getDay());
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const out: Date[] = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }, [month]);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch(`/api/calendar?from=${ymd(days[0]!)}&to=${ymd(days.at(-1)!)}`);
    if (res.ok) setData((await res.json()) as CalendarResponse);
    else setError(await readError(res));
  }, [apiFetch, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = (key: string) => ({
    posts: (data?.posts ?? []).filter((p) => ymd(new Date(p.scheduledFor)) === key),
    facts: (data?.facts ?? []).filter((f) => ymd(new Date(f.expiresAt)) === key),
  });
  const today = ymd(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-stone-600">Scheduled posts and the dates facts stop being used. Set a post&apos;s date when you write or edit it.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={secondaryButtonClass} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
            ←
          </button>
          <span className="w-40 text-center font-medium">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <button className={secondaryButtonClass} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
            →
          </button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg bg-stone-200 ring-1 ring-stone-200">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-stone-50 px-2 py-1 text-xs font-medium text-stone-600">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const key = ymd(d);
            const { posts, facts } = byDay(key);
            const inMonth = d.getMonth() === month.getMonth();
            return (
              <div key={key} className={`min-h-24 bg-white p-1.5 ${inMonth ? '' : 'bg-stone-50 text-stone-400'}`}>
                <p className={`text-xs ${key === today ? 'inline-block rounded-full bg-stone-900 px-1.5 text-white' : ''}`}>{d.getDate()}</p>
                <ul className="mt-1 space-y-1">
                  {posts.map((p) => (
                    <li key={p.itemId}>
                      <Link to={`/posts/${p.itemId}`} className="flex items-start gap-1 text-xs hover:underline" title={`${POST_STATUS_LABELS[p.status]} · ${CHANNEL_LABELS[p.channel]}`}>
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[p.status] ?? 'bg-stone-400'}`} aria-hidden />
                        <span>
                          {time(p.scheduledFor)} {p.title}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {facts.map((f) => (
                    <li key={f.itemId}>
                      <Link to="/knowledge" className="block text-xs text-red-700 hover:underline">
                        Fact ends: {f.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-stone-500">
        Dots: <span className="text-stone-500">grey draft</span> · <span className="text-amber-700">amber waiting for approval</span> · <span className="text-green-700">green approved</span> ·{' '}
        <span className="text-sky-700">blue posted</span>
      </p>

      {data && data.unscheduled.length > 0 && (
        <Card title="Posts without a date">
          <ul className="space-y-1 text-sm">
            {data.unscheduled.map((p) => (
              <li key={p.itemId}>
                <Link to={`/posts/${p.itemId}`} className="underline">
                  {p.title}
                </Link>{' '}
                <span className="text-xs text-stone-500">({POST_STATUS_LABELS[p.status]})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
