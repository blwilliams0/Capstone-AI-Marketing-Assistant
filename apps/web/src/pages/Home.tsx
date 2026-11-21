import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ROLE_DESCRIPTIONS } from '@the-pocket/shared';
import { useAuth } from '../auth';
import { Card } from '../ui';

export const CAPABILITY_LABELS: Record<string, string> = {
  'knowledge.view': 'Read approved marketing material',
  'knowledge.propose': 'Suggest new brand rules, facts and documents',
  'assistant.use': 'Ask the marketing assistant',
  'analytics.view': 'See marketing reports',
  'content.view': 'See posts and their approval history',
  'content.draft': 'Draft marketing content',
  'approval.request': 'Submit drafts for review',
  'data.import': 'Import sales and reservation reports',
  'post.approve': 'Approve other people\'s marketing posts',
  'post.record': 'Record approved posts as posted',
  'brand.approve': 'Approve brand rules and facts',
  'channel.connect': 'Connect social media accounts',
  'users.invite': 'Invite staff',
  'users.manage': 'Change or remove staff access',
  'data.export': 'Export data',
  'analytics.view_sensitive': 'See sensitive reports',
  'audit.view': 'See the activity history',
};

export function Home() {
  const { me, apiFetch } = useAuth();
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');

  useEffect(() => {
    apiFetch('/health')
      .then((r) => setHealth(r.ok ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
  }, [apiFetch]);

  if (!me) return null;
  const can = (c: string) => me.capabilities.includes(c);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hello, {me.name}</h1>
        <p className="text-stone-600">{ROLE_DESCRIPTIONS[me.role]}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {can('assistant.use') && (
          <Link to="/assistant" className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
            <p className="font-medium">Ask the marketing assistant</p>
            <p className="text-sm text-stone-600">Practical answers grounded in The Pocket's approved brand and strategy, with sources.</p>
          </Link>
        )}
        {can('content.draft') && (
          <Link to="/create" className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
            <p className="font-medium">Create a post</p>
            <p className="text-sm text-stone-600">Choose locals or visitors, a channel and a goal; get on-brand draft options.</p>
          </Link>
        )}
        {can('knowledge.view') && (
          <Link to="/knowledge" className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
            <p className="font-medium">Manage The Pocket's knowledge</p>
            <p className="text-sm text-stone-600">Approved brand rules, verified facts, the marketing strategy and research.</p>
          </Link>
        )}
        {can('users.manage') && (
          <Link to="/staff" className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
            <p className="font-medium">Staff access</p>
            <p className="text-sm text-stone-600">Invite people, see who has access, remove access.</p>
          </Link>
        )}
        {can('content.view') && (
          <Link to="/posts" className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
            <p className="font-medium">{can('post.approve') ? 'Review and approve posts' : 'Posts'}</p>
            <p className="text-sm text-stone-600">Drafts, posts waiting for approval, and everything already posted.</p>
          </Link>
        )}
        {can('post.record') && (
          <Link to="/ready" className="block rounded-lg bg-white p-5 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
            <p className="font-medium">Ready to post</p>
            <p className="text-sm text-stone-600">Copy the approved text, post it yourself, and record it.</p>
          </Link>
        )}
        <div className="rounded-lg border border-dashed border-stone-300 p-5 text-stone-500">
          <p className="font-medium">Plan and measure</p>
          <p className="text-sm">Coming next.</p>
        </div>
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
