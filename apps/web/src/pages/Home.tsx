import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { APPROVAL_EVENT_LABELS, POST_STATUS_LABELS, type ActivityEntry, type CalendarResponse, type NotificationsResponse, type PostSummary } from '@the-pocket/shared';
import { Composer, StudioIcon } from '../advisor/Composer';
import { useAuth } from '../auth';
import { Alert, Card, secondaryButtonClass } from '../ui';

export const CAPABILITY_LABELS: Record<string, string> = {
  'knowledge.view': 'Read approved marketing material',
  'knowledge.propose': 'Suggest new brand rules, facts and documents',
  'interview.conduct': 'Run brand interviews with management',
  'assistant.use': 'Ask the marketing assistant',
  'analytics.view': 'See marketing reports',
  'content.view': 'See posts and their approval history',
  'content.draft': 'Draft marketing content',
  'approval.request': 'Submit drafts for review',
  'data.import': 'Import sales and reservation reports',
  'post.approve': "Approve other people's marketing posts",
  'post.record': 'Record approved posts as posted',
  'brand.approve': 'Approve brand rules and facts',
  'channel.connect': 'Connect social media accounts',
  'users.invite': 'Invite staff',
  'users.manage': 'Change or remove staff access',
  'data.export': 'Export data',
  'analytics.view_sensitive': 'See sensitive reports',
  'audit.view': 'See the activity history',
};

type OverviewData = {
  reminders: NotificationsResponse;
  posts: PostSummary[];
  calendar: CalendarResponse;
  activity: ActivityEntry[];
};

function dayKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (key: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === key)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
  timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
});

export function Home() {
  const { me, apiFetch } = useAuth();
  const navigate = useNavigate();
  const sent = useRef(false);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<{ data?: OverviewData; error?: boolean }>({});
  const [attempt, setAttempt] = useState(0);
  const canRead = me?.capabilities.includes('content.view') ?? false;

  useEffect(() => {
    let current = true;
    async function get<T>(path: string): Promise<T> {
      const response = await apiFetch(path);
      if (!response.ok) throw new Error('Overview request failed');
      return response.json() as Promise<T>;
    }
    const now = new Date();
    const from = dayKey(now);
    const to = dayKey(new Date(now.getTime() + 15 * 86400000));
    async function load() {
      try {
        const [reminders, posts, calendar, activity] = await Promise.all([
          get<NotificationsResponse>('/api/notifications'),
          canRead ? get<{ posts: PostSummary[] }>('/api/posts') : { posts: [] },
          canRead ? get<CalendarResponse>(`/api/calendar?from=${from}&to=${to}`) : { posts: [], facts: [], unscheduled: [] },
          canRead ? get<{ activity: ActivityEntry[] }>('/api/activity?limit=5') : { activity: [] },
        ]);
        if (current) setState({ data: { reminders, posts: posts.posts, calendar, activity: activity.activity } });
      } catch {
        if (current) setState({ error: true });
      }
    }
    void load();
    return () => { current = false; };
  }, [apiFetch, canRead, attempt]);

  if (!me) return null;
  const can = (capability: string) => me.capabilities.includes(capability);
  const data = state.data;
  const unread = data?.reminders.notifications.filter((notification) => !notification.read).slice(0, 5) ?? [];
  const upcoming = data?.calendar.posts.filter((post) => post.status !== 'posted' && post.status !== 'archived' && Date.parse(post.scheduledFor) >= Date.now())
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor)).slice(0, 5) ?? [];
  const facts = data?.calendar.facts.slice(0, 5) ?? [];
  const counts = [
    { label: 'Pending approvals', status: 'in_review', to: '/posts?filter=review' },
    { label: 'Unsubmitted drafts', status: 'draft', to: '/posts?filter=work' },
    { label: 'Approved without source blockers', status: 'approved', to: can('post.record') ? '/ready' : '/posts?filter=ready' },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <h1 className="text-4xl font-semibold text-studio-ink sm:text-5xl">Hi, {me.name?.trim().split(/\s+/)[0] || 'there'}!</h1>
        {can('assistant.use') && <Composer home value={question} onChange={setQuestion}
          attachmentTools={__MOCK_AUTH__ && can('content.draft')}
          onSend={(text, photo) => {
            if (sent.current) return;
            sent.current = true;
            navigate('/assistant', { state: { question: text, assetId: photo?.id } });
          }} />}
        <div className="flex flex-wrap gap-2">
          {([
            ['assistant.use', '/assistant', 'chat', 'Brainstorm ideas'],
            ['content.draft', '/visual', 'photo', 'Edit a photo'],
            ['content.draft', '/feed-planner', 'grid', 'Preview our feed'],
            ['content.draft', '/visual?albums=1', 'grid', 'Browse albums'],
            ['knowledge.view', '/knowledge', 'book', 'Explore Brand Studio'],
            ['content.draft', '/create', 'file', 'Create marketing content'],
          ] as const).filter(([capability]) => can(capability)).map(([, to, icon, label]) =>
            <Link key={to} className={`${secondaryButtonClass} inline-flex items-center gap-2 rounded-full`} to={to}><StudioIcon name={icon} />{label}</Link>)}
        </div>
      </header>
      {state.error && <Alert kind="error">Could not load At a Glance. <button className="underline" onClick={() => { setState({}); setAttempt((value) => value + 1); }}>Try again</button></Alert>}
      {!state.error && !data && <p role="status" className="text-sm text-stone-600">Loading marketing activity…</p>}
      {data && (
        <>
          {canRead && (
            <section aria-label="Recent content" className="grid gap-3 sm:grid-cols-3">
              {counts.map(({ label, status, to }) => (
                <Link key={status} to={to} className="rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-400">
                  <span className="block font-serif text-3xl text-stone-900">{data.posts.filter((post) => post.status === status && (status !== 'approved' || !post.blockers.length)).length}</span>
                  <span className="text-sm">{label}</span>
                </Link>
              ))}
            </section>
          )}
          {data.posts.length >= 200 && <p className="text-xs text-stone-600">Counts cover the 200 most recent records returned by Content.</p>}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Needs attention">
              {unread.length ? <ul className="divide-y divide-stone-200">{unread.map((notification) => (
                <li key={notification.id} className="py-2">
                  <Link to={notification.link} className="text-sm font-semibold underline-offset-4 hover:underline">{notification.title}</Link>
                  <p className="text-sm text-stone-600">{notification.body}</p>
                </li>
              ))}</ul> : <p className="text-sm text-stone-600">You have no unread reminders.</p>}
              <Link className="mt-3 inline-block text-sm underline underline-offset-4" to="/reminders">View reminders{data.reminders.unread ? ` (${data.reminders.unread} unread)` : ''}</Link>
            </Card>
            {canRead && <Card title="Upcoming marketing">
              {upcoming.length ? <ul className="divide-y divide-stone-200">{upcoming.map((post) => (
                <li key={post.itemId} className="flex justify-between gap-3 py-2 text-sm">
                  <div><Link className="font-semibold hover:underline" to={`/posts/${post.itemId}`}>{post.title}</Link>
                    <p className="text-stone-600">{POST_STATUS_LABELS[post.status]}</p></div>
                  <span className="shrink-0 text-stone-600">{formatDate(post.scheduledFor)}</span>
                </li>
              ))}</ul> : <p className="text-sm text-stone-600">No upcoming content is scheduled.</p>}
              <Link className="mt-3 inline-block text-sm underline underline-offset-4" to="/calendar">Open Marketing Calendar</Link>
            </Card>}
            {canRead && <Card title="Expiring facts">
              {facts.length ? <ul className="divide-y divide-stone-200">{facts.map((fact) => (
                <li key={fact.itemId} className="flex justify-between gap-3 py-2 text-sm">
                  <Link to="/knowledge?kind=fact" className="font-semibold hover:underline">{fact.title}</Link>
                  <span className="shrink-0 text-stone-600">{formatDate(fact.expiresAt)}</span>
                </li>
              ))}</ul> : <p className="text-sm text-stone-600">No fact expirations in the upcoming calendar window.</p>}
            </Card>}
            {canRead && <Card title="Recent activity">
              {data.activity.length ? <ul className="divide-y divide-stone-200">{data.activity.map((entry) => (
                <li key={entry.id} className="py-2 text-sm">
                  <Link className="font-semibold hover:underline" to={`/posts/${entry.itemId}`}>{entry.postTitle}</Link>
                  <p className="text-stone-600">{APPROVAL_EVENT_LABELS[entry.event] ?? entry.event} · {formatDate(entry.at)}</p>
                </li>
              ))}</ul> : <p className="text-sm text-stone-600">No recent content activity.</p>}
            </Card>}
          </div>
        </>
      )}
    </div>
  );
}
