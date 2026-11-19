import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ROLE_DESCRIPTIONS, type NotificationsResponse, type PostSummary } from '@the-pocket/shared';
import { useAuth } from '../auth';
import { Card } from '../ui';

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

interface Task {
  to: string;
  title: string;
  text: string;
  needs: string;
  /** A count shown on the tile, when something is waiting. */
  badge?: number;
}

function TaskTile({ t, n }: { t: Task; n: number }) {
  return (
    <Link to={t.to} className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
      <p className="flex items-center gap-2 font-medium">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-xs text-white">{n}</span>
        {t.title}
        {!!t.badge && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-800">{t.badge} waiting</span>}
      </p>
      <p className="mt-1 text-sm text-stone-600">{t.text}</p>
    </Link>
  );
}

export function Home() {
  const { me, apiFetch } = useAuth();
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [reminders, setReminders] = useState<NotificationsResponse | null>(null);

  useEffect(() => {
    apiFetch('/health')
      .then((r) => setHealth(r.ok ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
    apiFetch('/api/notifications')
      .then(async (r) => r.ok && setReminders((await r.json()) as NotificationsResponse))
      .catch(() => {});
  }, [apiFetch]);

  useEffect(() => {
    if (!me?.capabilities.includes('content.view')) return;
    apiFetch('/api/posts')
      .then(async (r) => r.ok && setPosts(((await r.json()) as { posts: PostSummary[] }).posts))
      .catch(() => {});
  }, [apiFetch, me]);

  if (!me) return null;
  const can = (c: string) => me.capabilities.includes(c);
  const waiting = posts.filter((p) => p.status === 'in_review').length;
  const ready = posts.filter((p) => p.status === 'approved').length;
  const needsWork = posts.filter((p) => (p.status === 'changes_requested' || p.status === 'rejected') && p.createdBy.id === me.userId).length;

  const tasks: Task[] = [
    { to: '/assistant', title: 'Ask the marketing assistant', text: "Practical answers grounded in The Pocket's approved brand and strategy, with sources.", needs: 'assistant.use' },
    { to: '/create', title: 'Create a post', text: 'Choose locals or visitors, a channel and a goal; get on-brand options and a photo plan.', needs: 'content.draft' },
    {
      to: '/posts',
      title: can('post.approve') ? 'Review and approve' : 'Your posts',
      text: can('post.approve') ? 'Check the exact text, then approve, ask for changes or decline.' : 'Drafts, posts waiting for approval, and feedback from reviewers.',
      needs: 'content.view',
      badge: can('post.approve') ? waiting : needsWork,
    },
    { to: '/ready', title: 'Ready to post', text: 'Copy the approved text, post it yourself, and record it.', needs: 'post.record', badge: ready },
    {
      to: can('interview.conduct') ? '/interviews' : '/knowledge',
      title: 'Keep the brand right',
      text: can('brand.approve') ? 'Approve brand rules and facts, check what is expiring, run brand interviews.' : 'Approved brand rules and facts, and brand interviews with management.',
      needs: 'knowledge.view',
    },
  ];
  const mine = tasks.filter((t) => can(t.needs));
  const unread = (reminders?.notifications ?? []).filter((n) => !n.read).slice(0, 4);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hello, {me.name}</h1>
        <p className="text-stone-600">{ROLE_DESCRIPTIONS[me.role]}</p>
      </div>

      {unread.length > 0 && (
        <Card title="Needs you today">
          <ul className="space-y-2">
            {unread.map((n) => (
              <li key={n.id}>
                <Link to={n.link} className="text-sm font-medium underline">
                  {n.title}
                </Link>
                <p className="text-xs text-stone-600">{n.body}</p>
              </li>
            ))}
          </ul>
          {(reminders?.unread ?? 0) > unread.length && (
            <Link to="/reminders" className="mt-3 inline-block text-sm underline">
              See all {reminders!.unread} reminders
            </Link>
          )}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {mine.map((t, i) => (
          <TaskTile key={t.to + t.title} t={t} n={i + 1} />
        ))}
        {can('content.view') && (
          <Link to="/photo-guide" className="block rounded-lg border border-dashed border-stone-300 p-5 hover:border-stone-500">
            <p className="font-medium">Photo guide</p>
            <p className="text-sm text-stone-600">How to take restaurant photos with a phone that look like The Pocket.</p>
          </Link>
        )}
      </div>

      <Card title="What you can do">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {me.capabilities.map((c) => (
            <li key={c}>{CAPABILITY_LABELS[c] ?? c}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-stone-500">For information only. The server checks your permissions on every action.</p>
        <p className="mt-4 text-sm">
          Server status:{' '}
          <span className={health === 'ok' ? 'text-green-700' : health === 'down' ? 'text-red-700' : 'text-stone-500'}>
            {health === 'ok' ? 'connected' : health === 'down' ? 'not reachable' : 'checking…'}
          </span>
        </p>
      </Card>
    </div>
  );
}
