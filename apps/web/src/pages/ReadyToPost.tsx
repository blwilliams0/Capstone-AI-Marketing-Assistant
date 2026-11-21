import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CHANNEL_LABELS, type ReadyToPostCard } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';
import { VersionBody, shortPrint } from './PostDetail';

const WHERE_TO_POST: Record<string, string> = {
  instagram: 'Open Instagram on the restaurant account, create a post, add the photos, then paste the text.',
  facebook: 'Open the restaurant Facebook Page, create a post, add the photos, then paste the text.',
  email: 'Open your email tool, start a campaign to opted-in guests only, and paste the text (first line is the subject).',
  google_business: 'Open the Google Business Profile, choose "Add update", add a photo and paste the text.',
  website: 'Open the website editor and paste the text in the right place.',
};

function ReadyCard({ card, onDone }: { card: ReadyToPostCard; onDone: (msg: string) => void }) {
  const { apiFetch } = useAuth();
  const [copied, setCopied] = useState(false);
  const [postUrl, setPostUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = card.blockers.length > 0;

  async function markPosted() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/approvals/${card.approvalId}/posted`, { method: 'POST', body: { digest: card.digest, postUrl, note: note || undefined } });
    setBusy(false);
    if (res.ok) onDone(`"${card.title}" recorded as posted.`);
    else setError(await readError(res));
  }

  return (
    <Card title={card.title}>
      <div className="space-y-4">
        <p className="text-sm text-stone-600">
          Approved by {card.approvedBy.name}
          {card.selfApproved && ' (their own post)'} on {new Date(card.approvedAt).toLocaleString()} · fingerprint <code>{shortPrint(card.digest)}</code> ·{' '}
          <Link to={`/posts/${card.itemId}`} className="underline">
            details
          </Link>
        </p>
        {card.blockers.map((b, i) => (
          <Alert key={i} kind="error">
            {b}
          </Alert>
        ))}
        <VersionBody v={card.version} />
        {!blocked && (
          <>
            <button
              className={secondaryButtonClass}
              onClick={() => {
                void navigator.clipboard?.writeText(card.version.caption);
                setCopied(true);
              }}
            >
              {copied ? 'Copied the approved text' : 'Copy the approved text'}
            </button>
            <div className="rounded-md bg-stone-50 p-3 text-sm">
              <p className="font-medium">How to post on {CHANNEL_LABELS[card.version.channel]}</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>{WHERE_TO_POST[card.version.channel]}</li>
                <li>Paste the text exactly as approved. If you need to change anything, edit the post here and get it approved again.</li>
                <li>Publish, then copy the link to the live post and record it below.</li>
              </ol>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Link to the live post (optional)
                <input className={inputClass} type="url" placeholder="https://" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">
                Note (optional)
                <input className={inputClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            {error && <Alert kind="error">{error}</Alert>}
            <button className={buttonClass} disabled={busy} onClick={() => void markPosted()}>
              {busy ? 'Saving…' : 'I posted it'}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

export function ReadyToPost() {
  const { apiFetch } = useAuth();
  const [cards, setCards] = useState<ReadyToPostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/posts/ready');
    if (res.ok) setCards(((await res.json()) as { ready: ReadyToPostCard[] }).ready);
    else setError(await readError(res));
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ready to post</h1>
        <p className="text-sm text-stone-600">
          Approved posts waiting to go live. The app never posts for you: copy the approved text, post it yourself, then record it here so the history stays complete.
        </p>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {cards === null && !error && <p className="text-sm text-stone-500">Loading…</p>}
      {cards?.length === 0 && <p className="text-sm text-stone-500">Nothing is waiting. Approved posts will appear here.</p>}
      {cards?.map((c) => (
        <ReadyCard
          key={c.approvalId}
          card={c}
          onDone={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      ))}
    </div>
  );
}
