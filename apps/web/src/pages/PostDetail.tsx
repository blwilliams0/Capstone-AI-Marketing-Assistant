import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { APPROVAL_EVENT_LABELS, AUDIENCE_LABELS, CHANNEL_LABELS, type PostDetail as Detail, type PostVersionView } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';
import { StatusChip } from './Posts';

const fmt = (iso: string) => new Date(iso).toLocaleString();
export const shortPrint = (digest: string) => digest.slice(0, 12);

export function VersionBody({ v }: { v: PostVersionView }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">
        {CHANNEL_LABELS[v.channel]} · {AUDIENCE_LABELS[v.audience]}
        {v.angle && <> · {v.angle}</>}
      </p>
      <p className="whitespace-pre-wrap rounded bg-stone-50 p-3 text-sm">{v.caption}</p>
      {v.photoPlan && (
        <div>
          <h3 className="text-sm font-medium">Photo plan</h3>
          <p className="whitespace-pre-wrap text-sm">{v.photoPlan}</p>
        </div>
      )}
      {v.removedSources.length > 0 && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          <span className="font-medium">Check before approving: </span>
          this version no longer has support from {v.removedSources.map((s) => `"${s.title}"`).join(', ')}, which{' '}
          {v.removedSources.length === 1 ? 'was' : 'were'} retired or expired. Make sure the text doesn&apos;t still depend on {v.removedSources.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      <p className="text-xs text-stone-600">
        Relies on:{' '}
        {v.sources.length === 0
          ? 'no approved brand rules or facts. Reviewers: check every claim by hand.'
          : v.sources.map((s, i) => (
              <span key={s.versionId} className={s.current ? '' : 'text-red-700'}>
                {i > 0 && ', '}
                {s.title}
                {!s.current && ' (changed since)'}
              </span>
            ))}
      </p>
    </div>
  );
}

export function PostDetail() {
  const { itemId } = useParams();
  const { me, apiFetch } = useAuth();
  const [post, setPost] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState('');
  const [photoPlan, setPhotoPlan] = useState('');
  const [note, setNote] = useState('');
  const [confirmSelf, setConfirmSelf] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/posts/${itemId}`);
    if (res.ok) setPost((await res.json()) as Detail);
    else setError(await readError(res));
  }, [apiFetch, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return null;
  if (!post) return error ? <Alert kind="error">{error}</Alert> : <p className="text-sm text-stone-500">Loading…</p>;

  const can = (c: string) => me.capabilities.includes(c);
  const latest = post.versions[0]!;
  const open = post.openApproval;
  const locked = post.status === 'posted' || post.status === 'archived';
  const isSelf = !!open && (open.requestedBy.id === me.userId || latest.createdBy.id === me.userId);

  async function act(path: string, body: object, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(path, { method: 'POST', body });
    setBusy(false);
    if (res.ok) {
      setNotice(success);
      setNote('');
      setConfirmSelf(false);
      await load();
      return true;
    }
    setError(await readError(res));
    return false;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/posts" className="text-sm text-stone-600 hover:underline">
          ← All posts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{post.title}</h1>
          <StatusChip status={post.status} />
        </div>
        <p className="text-sm text-stone-600">
          Started by {post.createdBy.name} on {fmt(post.createdAt)} · version {latest.version}
        </p>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {post.blockers.map((b, i) => (
        <Alert key={i} kind="error">
          {b}
        </Alert>
      ))}

      <Card title={`Current text (version ${latest.version})`}>
        {editing ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Post text
              <textarea className={`${inputClass} min-h-40`} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={10000} />
            </label>
            <label className="block text-sm font-medium">
              Photo plan
              <textarea className={`${inputClass} min-h-20`} value={photoPlan} onChange={(e) => setPhotoPlan(e.target.value)} maxLength={4000} />
            </label>
            {open && <Alert kind="info">Saving creates a new version. The current {open.status === 'approved' ? 'approval' : 'approval request'} will no longer apply.</Alert>}
            <div className="flex gap-2">
              <button
                className={buttonClass}
                disabled={busy || !caption.trim()}
                onClick={async () => {
                  if (await act(`/api/posts/${post.id}/versions`, { caption, photoPlan }, 'Saved as a new version.')) setEditing(false);
                }}
              >
                Save new version
              </button>
              <button className={secondaryButtonClass} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <VersionBody v={latest} />
            <p className="mt-3 text-xs text-stone-500">
              Written by {latest.createdBy.name} {latest.origin === 'ai_draft' ? '(from an assistant draft)' : ''} on {fmt(latest.createdAt)} · fingerprint{' '}
              <code>{shortPrint(latest.digest)}</code>
            </p>
            {!locked && (
              <div className="mt-4 flex flex-wrap gap-2">
                {can('content.draft') && (
                  <button
                    className={secondaryButtonClass}
                    onClick={() => {
                      setCaption(latest.caption);
                      setPhotoPlan(latest.photoPlan);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                )}
                {can('approval.request') && !open && (
                  <button className={buttonClass} disabled={busy} onClick={() => void act(`/api/posts/${post.id}/submit`, {}, 'Submitted for approval.')}>
                    Submit for approval
                  </button>
                )}
                {can('content.draft') && (
                  <button
                    className={secondaryButtonClass}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Archive this post? It stays in the history but cannot be submitted or posted.')) void act(`/api/posts/${post.id}/archive`, {}, 'Archived.');
                    }}
                  >
                    Archive
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {open?.status === 'pending' && (
        <Card title="Waiting for approval">
          <p className="text-sm">
            Submitted by {open.requestedBy.name} on {fmt(open.requestedAt)}. Approval will cover exactly version {open.version} (fingerprint <code>{shortPrint(open.digest)}</code>).
          </p>
          {open.requestNote && <p className="mt-2 text-sm text-stone-600">Note: {open.requestNote}</p>}

          {can('post.approve') && (
            <div className="mt-4 space-y-3 border-t border-stone-200 pt-4">
              {isSelf && me.role !== 'admin' ? (
                <Alert kind="info">You wrote or submitted this post, so someone else must approve it.</Alert>
              ) : (
                <>
                  <p className="text-sm font-medium">Review checklist</p>
                  <ul className="list-disc pl-5 text-sm text-stone-700">
                    <li>Every dish, wine, date and price is confirmed by the kitchen or management.</li>
                    <li>No [brackets] or placeholders are left in the text.</li>
                    <li>It follows the brand rules it relies on (listed above).</li>
                    <li>No guest is identifiable without permission.</li>
                  </ul>
                  <label className="block text-sm font-medium">
                    Note (required to send back or decline)
                    <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                  </label>
                  {isSelf && (
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={confirmSelf} onChange={(e) => setConfirmSelf(e.target.checked)} />
                      You wrote or submitted this post. I have reviewed it and am approving my own work as an administrator. This is recorded.
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={buttonClass}
                      disabled={busy || (isSelf && !confirmSelf)}
                      onClick={() => void act(`/api/approvals/${open.id}/approve`, { note: note || undefined, confirmSelfApproval: isSelf ? confirmSelf : undefined }, 'Approved. It is now in Ready to post.')}
                    >
                      Approve this version
                    </button>
                    <button className={secondaryButtonClass} disabled={busy || !note.trim()} onClick={() => void act(`/api/approvals/${open.id}/request-changes`, { note }, 'Sent back for changes.')}>
                      Ask for changes
                    </button>
                    <button className={secondaryButtonClass} disabled={busy || !note.trim()} onClick={() => void act(`/api/approvals/${open.id}/reject`, { note }, 'Marked as not approved.')}>
                      Decline
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {can('approval.request') && (open.requestedBy.id === me.userId || me.role === 'admin') && (
            <button className={`${secondaryButtonClass} mt-3`} disabled={busy} onClick={() => void act(`/api/approvals/${open.id}/withdraw`, {}, 'Request withdrawn.')}>
              Withdraw request
            </button>
          )}
        </Card>
      )}

      {open?.status === 'approved' && (
        <Card title="Approved">
          <p className="text-sm">
            Approved by {open.decidedBy?.name} on {open.decidedAt && fmt(open.decidedAt)}
            {open.selfApproved && ' (their own post)'}.
          </p>
          {open.decisionNote && <p className="mt-1 text-sm text-stone-600">Note: {open.decisionNote}</p>}
          {can('post.record') && (
            <Link to="/ready" className={`${buttonClass} mt-3 inline-block`}>
              Go to Ready to post
            </Link>
          )}
        </Card>
      )}

      {post.post && (
        <Card title="Posted">
          <p className="text-sm">
            Posted by {post.post.postedBy.name} on {fmt(post.post.postedAt)}
            {post.post.postUrl && (
              <>
                {' '}
                ·{' '}
                <a href={post.post.postUrl} target="_blank" rel="noreferrer" className="underline">
                  view post
                </a>
              </>
            )}
          </p>
          {post.post.note && <p className="mt-1 text-sm text-stone-600">{post.post.note}</p>}
        </Card>
      )}

      {post.approvals.some((a) => a.status === 'changes_requested' || a.status === 'rejected') && post.status !== 'posted' && (
        <Card title="Feedback">
          <ul className="space-y-2 text-sm">
            {post.approvals
              .filter((a) => a.status === 'changes_requested' || a.status === 'rejected')
              .map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{a.decidedBy?.name}</span> {a.status === 'rejected' ? 'declined' : 'asked for changes to'} version {a.version}: {a.decisionNote}
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card title="History">
        <ol className="space-y-1 text-sm">
          {post.versions
            .slice()
            .reverse()
            .map((v) => (
              <li key={v.id} className="text-stone-600">
                {fmt(v.createdAt)} · {v.createdBy.name} saved version {v.version} <code className="text-xs">{shortPrint(v.digest)}</code>
              </li>
            ))}
          {post.activity.map((e) => (
            <li key={e.id}>
              {fmt(e.at)} · <span className="font-medium">{e.actor?.name ?? 'System'}</span> {APPROVAL_EVENT_LABELS[e.event] ?? e.event}
              {e.note && <span className="text-stone-600">: {e.note}</span>}
            </li>
          ))}
        </ol>
        {post.versions.length > 1 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-stone-600">Earlier versions</summary>
            <div className="mt-3 space-y-4">
              {post.versions.slice(1).map((v) => (
                <div key={v.id}>
                  <p className="text-xs font-medium">Version {v.version}</p>
                  <VersionBody v={v} />
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}
