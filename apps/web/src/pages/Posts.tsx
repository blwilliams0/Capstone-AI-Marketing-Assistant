import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  POST_STATUS_LABELS,
  type CreatePostRequest,
  type PostStatus,
  type PostSummary,
} from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';

const STATUS_STYLES: Record<PostStatus, string> = {
  draft: 'bg-stone-100 text-stone-700',
  in_review: 'bg-amber-100 text-amber-800',
  changes_requested: 'bg-orange-100 text-orange-800',
  rejected: 'bg-red-100 text-red-800',
  approved: 'bg-green-100 text-green-800',
  posted: 'bg-sky-100 text-sky-800',
  archived: 'bg-stone-100 text-stone-500',
};

export function StatusChip({ status }: { status: PostStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{POST_STATUS_LABELS[status]}</span>;
}

const FILTERS: { key: string; label: string; match: (s: PostStatus) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'review', label: 'Waiting for approval', match: (s) => s === 'in_review' },
  { key: 'work', label: 'Drafts and changes', match: (s) => s === 'draft' || s === 'changes_requested' || s === 'rejected' },
  { key: 'ready', label: 'Ready to post', match: (s) => s === 'approved' },
  { key: 'posted', label: 'Posted', match: (s) => s === 'posted' },
];

function WriteYourOwn() {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<CreatePostRequest>({ channel: 'instagram', audience: 'both', caption: '', angle: '' });
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch('/api/posts', {
      method: 'POST',
      body: { ...form, origin: 'human', scheduledFor: when ? new Date(when).toISOString() : undefined },
    });
    setBusy(false);
    if (res.ok) navigate(`/posts/${((await res.json()) as { itemId: string }).itemId}`);
    else setError(await readError(res));
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Channel
          <select className={inputClass} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as CreatePostRequest['channel'] })}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Audience
          <select className={inputClass} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as CreatePostRequest['audience'] })}>
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Short name for this post
        <input className={inputClass} maxLength={200} placeholder="e.g. Fall menu launch" value={form.angle ?? ''} onChange={(e) => setForm({ ...form, angle: e.target.value })} />
      </label>
      <label className="block text-sm font-medium">
        Post text
        <textarea className={`${inputClass} min-h-32`} required maxLength={10000} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
      </label>
      <label className="block text-sm font-medium">
        When should it go out? (optional; your local time)
        <input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      {error && <Alert kind="error">{error}</Alert>}
      <button className={buttonClass} disabled={busy}>
        {busy ? 'Saving…' : 'Save draft'}
      </button>
    </form>
  );
}

export function Posts() {
  const { me, apiFetch } = useAuth();
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const requestedFilter = params.get('filter');
  const filter = FILTERS.find((item) => item.key === requestedFilter)?.key ?? 'all';
  const [writing, setWriting] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/posts');
    if (res.ok) setPosts(((await res.json()) as { posts: PostSummary[] }).posts);
    else setError(await readError(res));
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return null;
  const canDraft = me.capabilities.includes('content.draft');
  const active = FILTERS.find((f) => f.key === filter)!;
  const shown = (posts ?? []).filter((p) => active.match(p.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Posts</h1>
          <p className="text-sm text-stone-600">Every post, from draft to approval to posted. Approval covers one exact version: editing an approved post sends it back for approval.</p>
        </div>
        {canDraft && (
          <div className="flex gap-2">
            <Link to="/create" className={secondaryButtonClass}>
              Draft with the assistant
            </Link>
            <button className={secondaryButtonClass} onClick={() => setWriting((w) => !w)}>
              {writing ? 'Close' : 'Write one yourself'}
            </button>
          </div>
        )}
      </div>

      {writing && (
        <Card title="Write a post yourself">
          <WriteYourOwn />
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => {
          const n = (posts ?? []).filter((p) => f.match(p.status)).length;
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setParams(f.key === 'all' ? {} : { filter: f.key })}
              className={`rounded-md border px-3 py-1 text-sm ${filter === f.key ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white hover:bg-stone-100'}`}
            >
              {f.label} ({n})
            </button>
          );
        })}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {posts === null && !error && <p className="text-sm text-stone-500">Loading…</p>}
      {posts !== null && shown.length === 0 && <p className="text-sm text-stone-500">Nothing here yet.</p>}

      <ul className="space-y-3">
        {shown.map((p) => (
          <li key={p.id}>
            <Link to={`/posts/${p.id}`} className="block rounded-lg bg-white p-4 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.title}</span>
                <StatusChip status={p.status} />
                <span className="text-xs text-stone-500">
                  {CHANNEL_LABELS[p.channel]} · v{p.latestVersion} · {p.createdBy.name} · updated {new Date(p.updatedAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-stone-600">{p.excerpt}</p>
              {p.blockers.length > 0 && <p className="mt-1 text-xs text-red-700">Needs updating: a brand rule or fact it relies on has changed.</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
