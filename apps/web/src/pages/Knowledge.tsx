import { VisualStandards } from '../visual/VisualStandards';
import { useSearchParams } from 'react-router';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_KINDS,
  type KnowledgeItemView,
  type KnowledgeKind,
  type KnowledgeVersionView,
} from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { toLocalInput } from './PostDetail';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';

interface BrandCore {
  entries: { itemId: string; title: string }[];
  words: number;
  maxWords: number;
}

const ORIGIN_LABELS: Record<KnowledgeVersionView['origin'], string> = {
  human: 'Written by staff',
  interview: 'From a management interview',
  ai_proposal: 'Suggested by the AI assistant',
};

const fmt = (iso: string) => new Date(iso).toLocaleString();

export function Knowledge() {
  const { me, apiFetch } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedKind = params.get('kind');
  const kind = KNOWLEDGE_KINDS.find((value) => value === selectedKind) ?? 'brand_rule';
  const [items, setItems] = useState<KnowledgeItemView[] | null>(null);
  const [core, setCore] = useState<BrandCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [learningIds, setLearningIds] = useState<string[]>([]);
  const [onlyLearnings, setOnlyLearnings] = useState(false);
  const [search, setSearch] = useState('');

  const canPropose = me?.capabilities.includes('knowledge.propose') ?? false;
  const canApprove = me?.capabilities.includes('brand.approve') ?? false;

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([apiFetch('/api/knowledge'), apiFetch('/api/knowledge/brand-core')]);
    if (a.ok) setItems(((await a.json()) as { items: KnowledgeItemView[] }).items);
    else setError(await readError(a));
    if (b.ok) setCore((await b.json()) as BrandCore);
    if (canApprove) {
      const learning = await apiFetch('/api/assistant/learnings');
      if (learning.ok) setLearningIds(((await learning.json()) as { itemIds: string[] }).itemIds);
      else setError(await readError(learning));
    }
  }, [apiFetch, canApprove]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body: object, success: string) => {
    setError(null);
    setNotice(null);
    const res = await apiFetch(path, { method: 'POST', body });
    if (res.ok) {
      setNotice(success);
      await load();
      return true;
    }
    setError(await readError(res));
    return false;
  };

  const query = search.trim().toLowerCase();
  const shown = (items ?? []).filter((item) =>
    item.kind === kind && (!onlyLearnings || learningIds.includes(item.id)) && (!query || item.title.toLowerCase().includes(query) || item.current?.body.toLowerCase().includes(query)),
  );
  const pendingCount = (k: KnowledgeKind) => (items ?? []).filter((i) => i.kind === k && i.pending.length > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Brand Studio</h1>
          <p className="text-sm text-stone-600">
            Only approved, current items are used by the assistant. Proposals wait here until an administrator approves the exact wording.
          </p>
        </div>
        {canPropose && (
          <button className={buttonClass} onClick={() => setAdding(!adding)}>
            {adding ? 'Close' : 'New proposal'}
          </button>
        )}
      </div>

      {core && (
        <Alert kind="info">
          <strong>Brand core</strong> (sent with every assistant request): {core.entries.length} items, {core.words.toLocaleString()} of{' '}
          {core.maxWords.toLocaleString()} words.
        </Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <VisualStandards propose />
      {canApprove && <button type="button" className={secondaryButtonClass} aria-pressed={onlyLearnings}
        onClick={() => { setOnlyLearnings(!onlyLearnings); setParams({ kind: 'brand_rule' }); }}>
        {onlyLearnings ? 'Show all brand rules' : 'Review staff learning proposals'}
      </button>}

      {adding && (
        <AddForm
          initialKind={kind}
          onSubmit={async (body) => {
            if (await act('/api/knowledge', body, 'Saved as a proposal. An administrator needs to approve it before the assistant uses it.')) setAdding(false);
          }}
        />
      )}

      <div className="flex flex-wrap gap-2 border-b border-stone-200">
        {KNOWLEDGE_KINDS.map((k) => (
          <button
            aria-pressed={k === kind}
            key={k}
            onClick={() => { setOnlyLearnings(false); setParams({ kind: k }); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${k === kind ? 'border-stone-900 font-medium' : 'border-transparent text-stone-600'}`}
          >
            {KNOWLEDGE_KIND_LABELS[k].name}
            {canPropose && pendingCount(k) > 0 && <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900">{pendingCount(k)}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">{KNOWLEDGE_KIND_LABELS[kind].description}</p>
        <input aria-label="Filter knowledge in this category" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter this category" type="search" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
      </div>

      {!items && !error && <p className="text-sm text-stone-500">Loading…</p>}
      {items && shown.length === 0 && <p className="text-sm text-stone-500">{query ? 'No items match this filter.' : 'Nothing here yet.'}</p>}
      <div className="space-y-4">
        {shown.map((item) => (
          <ItemCard key={item.id} item={item} canPropose={canPropose} canApprove={canApprove} myId={me?.userId ?? ''} act={act} />
        ))}
      </div>
    </div>
  );
}

function AddForm({ initialKind, onSubmit }: { initialKind: KnowledgeKind; onSubmit: (body: object) => Promise<void> }) {
  const [kind, setKind] = useState<KnowledgeKind>(initialKind);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(md|txt)$/i.test(f.name) || f.size > 90_000) {
      setFileError('Please choose a .md or .txt file under 90 KB.');
      return;
    }
    setBody(await f.text());
    if (!title) setTitle(f.name.replace(/\.(md|txt)$/i, '').replace(/[_-]+/g, ' '));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSubmit({
      kind,
      title,
      body,
      sourceNote: sourceNote || undefined,
      expiresAt: expires ? new Date(expires).toISOString() : undefined,
    });
    setBusy(false);
  }

  return (
    <Card title="Add to the knowledge library">
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          Type
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
            {KNOWLEDGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KNOWLEDGE_KIND_LABELS[k].name}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-stone-600">{KNOWLEDGE_KIND_LABELS[kind].description}</span>
        </label>
        <label className="block text-sm font-medium">
          Title
          <input className={inputClass} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Text
          <textarea className={`${inputClass} min-h-40 font-mono text-sm`} required value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {(kind === 'strategy' || kind === 'reference') && (
          <label className="block text-sm font-medium">
            Or upload a .md or .txt file
            <input type="file" accept=".md,.txt,text/markdown,text/plain" className="mt-1 block text-sm" onChange={readFile} />
            {fileError && <span className="mt-1 block text-red-700">{fileError}</span>}
          </label>
        )}
        <label className="block text-sm font-medium">
          Source (who confirmed this, or where it came from)
          <input className={inputClass} maxLength={500} value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="e.g. Confirmed by Chef Mike, Nov 14" />
        </label>
        {kind === 'fact' && (
          <label className="block text-sm font-medium">
            Stop using this fact after (optional)
            <input className={inputClass} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
        )}
        <button className={buttonClass} disabled={busy}>
          {busy ? 'Saving…' : 'Save as proposal'}
        </button>
      </form>
    </Card>
  );
}

function VersionText({ v }: { v: KnowledgeVersionView }) {
  const [full, setFull] = useState(false);
  const long = v.body.length > 1200;
  return (
    <div className="space-y-1">
      <p className="whitespace-pre-wrap text-sm">{long && !full ? `${v.body.slice(0, 1200)}…` : v.body}</p>
      {long && (
        <button className="text-xs underline" onClick={() => setFull((f) => !f)}>
          {full ? 'Show less' : `Show the full text (${v.body.length.toLocaleString()} characters) before approving`}
        </button>
      )}
      <p className="text-xs text-stone-500">
        Version {v.version} · {ORIGIN_LABELS[v.origin]} · proposed by {v.proposedBy.name} {fmt(v.proposedAt)}
        {v.decidedBy && v.status !== 'proposed' && ` · approved by ${v.decidedBy.name} ${fmt(v.decidedAt!)}`}
        {v.sourceNote && ` · Source: ${v.sourceNote}`}
        {v.expiresAt && ` · ${v.expired ? 'Expired' : 'Expires'} ${fmt(v.expiresAt)}`}
      </p>
    </div>
  );
}

function ItemCard({
  item,
  canPropose,
  canApprove,
  myId,
  act,
}: {
  item: KnowledgeItemView;
  canPropose: boolean;
  canApprove: boolean;
  myId: string;
  act: (path: string, body: object, success: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.current?.body ?? '');
  const [sourceNote, setSourceNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  /** Opens the edit box filled from the CURRENT approved version (not stale text from earlier). */
  const startEditing = () => {
    const cur = item.current;
    setDraft(cur?.body ?? '');
    setSourceNote(cur?.sourceNote ?? '');
    setExpiresAt(cur?.expiresAt && !cur.expired ? toLocalInput(cur.expiresAt) : '');
    setEditing(true);
  };
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  return (
    <section className={`rounded-lg bg-white p-5 shadow-sm ring-1 ${item.retired ? 'opacity-60 ring-stone-200' : 'ring-stone-200'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{item.title}</h3>
        {item.inBrandCore && <span className="rounded bg-stone-900 px-1.5 text-xs text-white">Brand core</span>}
        {item.retired && <span className="rounded bg-stone-200 px-1.5 text-xs">Retired</span>}
        {!item.current && !item.retired && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">Not approved yet</span>}
        {item.current?.expired && <span className="rounded bg-red-100 px-1.5 text-xs text-red-800">Expired</span>}
      </div>

      {item.current ? <VersionText v={item.current} /> : <p className="text-sm text-stone-500">No approved version yet.</p>}

      {item.pending.map((p) => (
        <div key={p.id} className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-900">Proposed change, waiting for approval</p>
          <VersionText v={p} />
          {canApprove && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <button
                className={buttonClass}
                onClick={() => {
                  const self = p.proposedBy.id === myId;
                  if (self && !window.confirm('You proposed this yourself. Approve it exactly as written? This is recorded as a self-approval.')) return;
                  void act(`/api/knowledge/versions/${p.id}/approve`, { confirmSelfApproval: self }, 'Approved. The assistant will use this version.');
                }}
              >
                Approve exactly as written
              </button>
              {rejecting === p.id ? (
                <>
                  <input className={`${inputClass} max-w-sm`} placeholder="Why? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button
                    className={secondaryButtonClass}
                    disabled={!reason.trim()}
                    onClick={() => void act(`/api/knowledge/versions/${p.id}/reject`, { note: reason }, 'Rejected.').then(() => setRejecting(null))}
                  >
                    Confirm reject
                  </button>
                </>
              ) : (
                <button className={secondaryButtonClass} onClick={() => setRejecting(p.id)}>
                  Reject
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {!item.retired && (canPropose || canApprove) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canPropose && (
            <button className={secondaryButtonClass} onClick={() => (editing ? setEditing(false) : startEditing())}>
              {editing ? 'Cancel' : 'Propose a change'}
            </button>
          )}
          {canApprove && (item.kind === 'brand_rule' || item.kind === 'fact') && (
            <button
              className={secondaryButtonClass}
              onClick={() =>
                void act(`/api/knowledge/${item.id}/brand-core`, { inBrandCore: !item.inBrandCore }, item.inBrandCore ? 'Removed from the brand core.' : 'Added to the brand core.')
              }
            >
              {item.inBrandCore ? 'Remove from brand core' : 'Add to brand core'}
            </button>
          )}
          {canApprove && (
            <button
              className={secondaryButtonClass}
              onClick={() => {
                const why = window.prompt('Why is this being retired? The assistant will stop using it.');
                if (why?.trim()) void act(`/api/knowledge/${item.id}/retire`, { reason: why }, 'Retired.');
              }}
            >
              Retire
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2">
          <textarea className={`${inputClass} min-h-32 text-sm`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <label className="block text-sm font-medium">
            Source (who confirmed it, and when)
            <input className={inputClass} maxLength={500} value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} />
          </label>
          {item.kind === 'fact' && (
            <label className="block text-sm font-medium">
              Stop using it after (optional)
              <input type="datetime-local" className={inputClass} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
          )}
          <button
            className={buttonClass}
            disabled={!draft.trim()}
            onClick={() =>
              void act(
                `/api/knowledge/${item.id}/versions`,
                { body: draft, sourceNote: sourceNote.trim() || undefined, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined },
                'Proposed. The current approved version stays in use until this is approved.',
              ).then((ok) => ok && setEditing(false))
            }
          >
            Save proposal
          </button>
        </div>
      )}
    </section>
  );
}
