import { useEffect, useState } from 'react';
import type { PostDetail, PostSummary, VisualAsset } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, Card, inputClass, secondaryButtonClass } from '../ui';

interface Tile {
  id: string;
  label: string;
  endpoint: string;
}

function FeedImage({ tile }: { tile: Tile }) {
  const { apiFetch } = useAuth();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    void (async () => {
      const response = await apiFetch(tile.endpoint);
      if (!response.ok || !alive) return;
      if (response.headers.get('content-type')?.startsWith('image/')) {
        const bytes = await response.blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(bytes);
        setUrl(objectUrl);
      } else {
        const signed = (await response.json()) as { url: string };
        if (alive) setUrl(signed.url);
      }
    })().catch(() => {});
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiFetch, tile.endpoint]);

  return <div className="aspect-square overflow-hidden bg-studio-linen">
    {url ? <img alt={tile.label} src={url} className="h-full w-full object-cover" />
      : <p className="grid h-full place-items-center p-2 text-center text-xs text-studio-muted">Preview unavailable or loading</p>}
  </div>;
}

function savedPlan(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 24) : [];
  } catch { return []; }
}

function Planner({ storageKey }: { storageKey: string }) {
  const { apiFetch } = useAuth();
  const [ids, setIds] = useState(() => savedPlan(storageKey));
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [published, setPublished] = useState<Tile[]>([]);
  const [includePublished, setIncludePublished] = useState(true);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [library, content] = await Promise.all([apiFetch('/api/visual/assets'), apiFetch('/api/posts')]);
        if (!library.ok) throw new Error(await readError(library));
        if (!content.ok) throw new Error(await readError(content));
        const { assets } = await library.json() as { assets: VisualAsset[] };
        const { posts } = await content.json() as { posts: PostSummary[] };
        if (!alive) return;
        setAssets(assets);
        const recent = posts.filter((item) => item.status === 'posted' && item.channel === 'instagram').slice(0, 9);
        const details = await Promise.all(recent.map(async (item) => {
          const result = await apiFetch(`/api/posts/${item.id}`);
          if (!result.ok) return null;
          const detail = await result.json() as PostDetail;
          const posted = detail.post;
          const version = detail.versions.find((entry) => entry.digest === posted?.digest && entry.media);
          if (!posted || !version) return null;
          return {
            id: item.id, label: item.title, postedAt: posted.postedAt,
            endpoint: `/api/posts/${item.id}/media?versionId=${version.id}`,
          };
        }));
        if (alive) setPublished(details.filter((tile) => tile !== null).sort((a, b) => b.postedAt.localeCompare(a.postedAt)));
      } catch (failure) {
        if (alive) setError(failure instanceof Error ? failure.message : 'Could not load the planner.');
      } finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  }, [apiFetch]);

  function save(next: string[]) {
    setIds(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setStorageError('This browser could not save the plan. It will last until you leave this page.'); }
  }

  function move(id: string, offset: number) {
    const ordered = planned.map((item) => item.id);
    const index = ordered.indexOf(id);
    const next = index + offset;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next]!, ordered[index]!];
    save(ordered);
  }

  const planned = ids.flatMap((id) => assets.find((item) => item.id === id) ?? []);
  const available = assets.filter((item) => !ids.includes(item.id));

  return <div className="space-y-5">
    <header>
      <h1 className="text-4xl font-semibold">Feed Planner</h1>
      <p className="mt-1 text-sm text-studio-muted">Arrange an Instagram grid alongside photos manually recorded as posted. Plans are saved in this browser.</p>
    </header>
    {error && <Alert kind="error">{error}</Alert>}
    {storageError && <Alert kind="info">{storageError}</Alert>}
    <Card title="Build a grid">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Photo from your library
          <select className={inputClass} value={pick} onChange={(event) => setPick(event.target.value)}>
            <option value="">Choose a photo</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <button className={buttonClass} disabled={!pick || planned.length >= 24} onClick={() => { save([...planned.map((item) => item.id), pick]); setPick(''); }}>Add to plan</button>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={includePublished} onChange={(event) => setIncludePublished(event.target.checked)} /> Show recorded posts
        </label>
      </div>
    </Card>
    {loading && <p role="status" className="text-sm text-studio-muted">Loading photos…</p>}
    {!loading && !planned.length && (!includePublished || !published.length)
      && <p className="text-sm text-studio-muted">Choose a library photo to start the grid.</p>}
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {planned.map((item, index) => <article key={item.id} className="min-w-0 overflow-hidden rounded-md border border-studio-linen bg-studio-pearl">
        <FeedImage tile={{ id: item.id, label: item.label, endpoint: `/api/visual/assets/${item.id}/image?size=thumb` }} />
        <div className="p-2">
          <p className="text-xs font-semibold text-studio-muted">Planned</p>
          <p className="truncate text-sm">{item.label}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <button className={`${secondaryButtonClass} !px-2 !py-1`} aria-label={`Move ${item.label} earlier`} disabled={index === 0} onClick={() => move(item.id, -1)}>←</button>
            <button className={`${secondaryButtonClass} !px-2 !py-1`} aria-label={`Move ${item.label} later`} disabled={index === planned.length - 1} onClick={() => move(item.id, 1)}>→</button>
            <button className="px-1 text-xs underline" aria-label={`Remove ${item.label} from plan`} onClick={() => save(ids.filter((id) => id !== item.id))}>Remove</button>
          </div>
        </div>
      </article>)}
      {includePublished && published.map((item) => <article key={item.id} className="min-w-0 overflow-hidden rounded-md border border-studio-linen bg-studio-pearl">
        <FeedImage tile={item} />
        <div className="p-2"><p className="text-xs font-semibold text-studio-muted">Recorded as posted</p><p className="truncate text-sm">{item.label}</p></div>
      </article>)}
    </div>
  </div>;
}

export function FeedPlanner() {
  const { me } = useAuth();
  if (!me?.capabilities.includes('content.draft')) return <Alert kind="info">Your role does not have access to the feed planner.</Alert>;
  const key = `pocket.feed.${me.restaurantId}.${me.userId}`;
  return <Planner key={key} storageKey={key} />;
}
