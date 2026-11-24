import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { PostSummary, VisualAsset, VisualRecipe, VisualReviewResult } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, Card, inputClass, secondaryButtonClass } from '../ui';
import { PhotoEditor } from '../visual/PhotoEditor';

const accepted = ['image/jpeg', 'image/png', 'image/webp'];
const sections: [keyof VisualReviewResult, string][] = [
  ['observations', 'Observations'], ['brandConsiderations', 'Brand considerations'],
  ['recommendations', 'Recommendations'], ['verify', 'Check before using'],
];

function usePrivateImage(id: string, thumbnail = false) {
  const { apiFetch } = useAuth();
  const [result, setResult] = useState<{ id: string; url?: string }>();
  useEffect(() => {
    let canceled = false;
    let url: string | undefined;
    void (async () => {
      const response = await apiFetch(`/api/visual/assets/${id}/image?size=${thumbnail ? 'thumb' : 'full'}`);
      if (canceled) return;
      if (response.ok) {
        const blob = await response.blob();
        if (canceled) return;
        url = URL.createObjectURL(blob);
      }
      setResult({ id, url });
    })().catch(() => { if (!canceled) setResult({ id }); });
    return () => { canceled = true; if (url) URL.revokeObjectURL(url); };
  }, [id, thumbnail, apiFetch]);
  return result?.id === id ? result.url ?? null : undefined;
}

function AssetTile({ asset, active, open }: { asset: VisualAsset; active: boolean; open: () => void }) {
  const url = usePrivateImage(asset.id, true);
  return (
    <button type="button" onClick={open} aria-pressed={active}
      className={`overflow-hidden rounded-md border bg-studio-pearl text-left text-studio-ink ${active ? 'border-studio-slate ring-2 ring-studio-slate' : 'border-studio-linen hover:border-studio-taupe'}`}>
      {url ? <img src={url} alt="" className="aspect-[4/3] w-full object-cover" />
        : <div className="grid aspect-[4/3] place-items-center bg-studio-linen p-2 text-xs">{url === null ? 'Preview unavailable' : 'Loading preview…'}</div>}
      <span className="block truncate px-3 pt-2 text-sm font-semibold">{asset.label}</span>
      <span className="block px-3 pb-2 text-xs text-studio-muted">
        {asset.parentId ? 'Edited copy' : 'Source photo'} · {new Date(asset.createdAt).toLocaleDateString()}
      </span>
    </button>
  );
}

type Upload = { id: string; blob: Blob; label: string; parentId?: string; edits?: VisualRecipe };

export function VisualWorkspace({ advisor = false }: { advisor?: boolean }) {
  const { me, apiFetch } = useAuth();
  const [assets, setAssets] = useState<VisualAsset[]>();
  const [active, setActive] = useState<string>();
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [review, setReview] = useState<VisualReviewResult>();
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Upload>();
  const selected = assets?.find((asset) => asset.id === active);
  const canUse = me?.capabilities.includes('content.draft') ?? false;
  const canReview = me?.capabilities.includes('assistant.use') ?? false;

  const load = useCallback(async () => {
    const result = await apiFetch('/api/visual/assets');
    if (!result.ok) return setError(await readError(result));
    setAssets(((await result.json()) as { assets: VisualAsset[] }).assets);
  }, [apiFetch]);

  useEffect(() => {
    if (canUse) void load().catch(() => setError('Could not load the photo library.'));
  }, [canUse, load]);

  async function upload(request: Upload) {
    setBusy(true);
    setError('');
    setNotice('');
    setRetry(undefined);
    try {
      const response = await apiFetch('/api/visual/assets', {
        method: 'POST', body: request.blob,
        headers: {
          'X-Photo-Id': request.id, 'X-Photo-Label': encodeURIComponent(request.label),
          ...(request.parentId && { 'X-Photo-Parent': request.parentId, 'X-Photo-Edits': JSON.stringify(request.edits) }),
        },
      });
      if (!response.ok) {
        if (response.status >= 500) setRetry(request);
        throw new Error(await readError(response));
      }
      const saved = await response.json() as VisualAsset;
      setAssets((current) => [saved, ...(current ?? []).filter((item) => item.id !== saved.id)]);
      setActive(saved.id);
      if (advisor) {
        setReviewIds([saved.id]);
        setPrivacyConfirmed(false);
        setReview(undefined);
      }
      setNotice(request.parentId ? 'Edited copy saved.' : 'Photo added to your private library.');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Upload failed.';
      setError(message);
      if (request.parentId) throw new Error(message);
    } finally { setBusy(false); }
  }

  function receive(file?: File) {
    if (!file || busy) return;
    if (!accepted.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or WebP up to 10 MB.');
      return;
    }
    void upload({ id: crypto.randomUUID(), blob: file, label: [...file.name.replace(/\.[^.]+$/, '')].slice(0, 95).join('') || 'Photo' });
  }

  function toggleReview(id: string) {
    setReviewIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(0, 3));
    setReview(undefined);
    setPrivacyConfirmed(false);
  }

  async function assess() {
    setBusy(true);
    setReview(undefined);
    setError('');
    try {
      const response = await apiFetch('/api/visual/review', { method: 'POST', body: { ids: reviewIds, privacyConfirmed } });
      if (!response.ok) return setError(await readError(response));
      setReview(((await response.json()) as { review: VisualReviewResult }).review);
    } catch { setError('Could not read the photo review.'); }
    finally { setBusy(false); }
  }

  if (!canUse) return <Alert kind="info">Your role does not have access to private photo tools.</Alert>;
  const shown = (assets ?? []).filter((item) => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (view === 'all' || (view === 'edited') === Boolean(item.parentId)));

  return (
    <div className="space-y-5">
      {error && <Alert kind="error">{error} {retry && <button type="button" className="underline" onClick={() => void upload(retry).catch(() => {})}>Retry upload</button>}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-studio-taupe bg-studio-pearl p-4"
        onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); receive(event.dataTransfer.files[0]); }}>
        <div>
          <p className="font-semibold">{busy ? 'Working…' : 'Add a private photo'}</p>
          <p className="text-sm text-studio-muted">Drop a JPEG, PNG or WebP here, up to 10 MB.</p>
        </div>
        <label className={`${secondaryButtonClass} relative ${busy ? 'opacity-60' : 'cursor-pointer'} focus-within:outline-2`}>
          Choose photo
          <input type="file" aria-label="Choose photo" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" accept={accepted.join(',')} disabled={busy}
            onChange={(event) => { receive(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      </div>
      {!advisor && selected && <Card title={selected.label}>
        <SelectedPhoto key={selected.id} asset={selected} assets={assets ?? []} onSource={setActive}
          save={(blob, edits) => upload({ id: crypto.randomUUID(), blob, label: `${selected.label.slice(0, 84)} — edited`, parentId: selected.id, edits })} />
      </Card>}
      <Card title={advisor ? 'Photos for this review' : 'Your photo library'}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={`${inputClass} max-w-64`} type="search" aria-label="Search your photos" placeholder="Search your photos" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className={`${inputClass} max-w-40`} aria-label="Filter originals and edits" value={view} onChange={(event) => setView(event.target.value)}>
            <option value="all">All photos</option><option value="source">Source photos</option><option value="edited">Edited copies</option>
          </select>
        </div>
        {!assets ? <p className="text-sm text-studio-muted">Loading photo library…</p>
          : !shown.length ? <p className="text-sm text-studio-muted">{assets.length ? 'No photos match those filters.' : 'Add a photo above to start your library.'}</p>
            : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((asset) => (
                <div key={asset.id} className="grid gap-2">
                  <AssetTile asset={asset} active={advisor ? reviewIds.includes(asset.id) : active === asset.id}
                    open={() => advisor ? toggleReview(asset.id) : setActive(asset.id)} />
                  {!advisor && canReview && <label className="flex gap-2 text-sm">
                    <input type="checkbox" checked={reviewIds.includes(asset.id)} disabled={reviewIds.length === 3 && !reviewIds.includes(asset.id)}
                      onChange={() => toggleReview(asset.id)} /> Select for review
                  </label>}
                </div>
              ))}
            </div>}
      </Card>
      {canReview && <Card title="Practice photo review">
        <div className="space-y-3">
          <p className="text-sm text-studio-muted">Choose up to three photos for a simulated review. Images are processed locally in practice mode.</p>
          {reviewIds.length > 0 && <p className="text-sm font-semibold">Selected: {reviewIds.map((id) => assets?.find((asset) => asset.id === id)?.label).filter(Boolean).join(', ')}</p>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={privacyConfirmed} onChange={(event) => setPrivacyConfirmed(event.target.checked)} />
            I have permission to use these photos and they contain no identifiable guests or private details.
          </label>
          <button type="button" className={buttonClass} disabled={!privacyConfirmed || !reviewIds.length || busy} onClick={() => void assess()}>
            {reviewIds.length > 1 ? 'Run practice comparison' : 'Run practice review'}
          </button>
          {review && <div className="space-y-4" aria-live="polite">
            <Alert kind="info">Simulated result. The practice provider makes no visual judgments.</Alert>
            {sections.map(([key, title]) => <section key={key}>
              <h3 className="font-semibold">{title}</h3>
              <ul className="list-disc pl-5 text-sm">{review[key].map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>)}
          </div>}
        </div>
      </Card>}
    </div>
  );
}

function SelectedPhoto({ asset, assets, onSource, save }: {
  asset: VisualAsset; assets: VisualAsset[]; onSource: (id: string) => void;
  save: (blob: Blob, edits: VisualRecipe) => Promise<void>;
}) {
  const url = usePrivateImage(asset.id);
  const { apiFetch } = useAuth();
  const [posts, setPosts] = useState<PostSummary[]>();
  const [postId, setPostId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const source = assets.find((item) => item.id === asset.parentId);

  async function loadPosts() {
    const response = await apiFetch('/api/posts');
    if (!response.ok) return setError(await readError(response));
    setPosts(((await response.json()) as { posts: PostSummary[] }).posts.filter((item) => item.status !== 'posted' && item.status !== 'archived'));
  }

  async function attach() {
    if (!postId || !url || !window.confirm('Attaching this photo creates a new content version and invalidates any existing approval. Continue?')) return;
    setBusy(true);
    setError('');
    try {
      const blob = await (await fetch(url)).blob();
      const response = await apiFetch(`/api/posts/${postId}/media/practice`, { method: 'POST', body: blob });
      if (!response.ok) return setError(await readError(response));
      setMessage(postId);
    } catch { setError('Could not attach the photo.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    {source && <button className="text-sm font-semibold underline underline-offset-4" type="button" onClick={() => onSource(source.id)}>Open source: {source.label}</button>}
    {url ? <PhotoEditor url={url} save={save} /> : <p role="status">{url === null ? 'Photo unavailable.' : 'Loading image…'}</p>}
    {__MOCK_AUTH__ && url && <div className="flex flex-wrap items-end gap-2 border-t border-studio-linen pt-3">
      {!posts ? <button type="button" className={secondaryButtonClass} onClick={() => void loadPosts()}>Choose a draft to attach this version</button>
        : posts.length ? <>
          <label className="text-sm font-semibold">Content draft
            <select className={inputClass} value={postId} onChange={(event) => { setMessage(''); setPostId(event.target.value); }}>
              <option value="">Choose a draft</option>
              {posts.map((post) => <option key={post.id} value={post.id}>{post.title}</option>)}
            </select>
          </label>
          <button type="button" className={buttonClass} disabled={!postId || busy} onClick={() => void attach()}>Attach photo</button>
        </> : <Link to="/posts" className="text-sm underline">Create a draft before attaching a photo.</Link>}
    </div>}
    {message && <Alert kind="success"><Link className="underline" to={`/posts/${message}`}>Open the updated content draft</Link></Alert>}
    {error && <Alert kind="error">{error}</Alert>}
  </div>;
}

export function VisualStudio() {
  return <div className="space-y-5">
    <header>
      <h1 className="text-4xl font-semibold">Visual Studio</h1>
      <p className="mt-1 text-sm text-studio-muted">Prepare photographs, compare adjustments, and save edited versions.</p>
    </header>
    <VisualWorkspace />
  </div>;
}
