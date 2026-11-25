import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import type { PostDetail, PostSummary, VisualAsset, VisualCollection } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { CollectionVisibility } from '../visual/AlbumManager';
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
  const [layouts, setLayouts] = useState<VisualCollection[]>([]);
  const [albums, setAlbums] = useState<VisualCollection[]>([]);
  const [albumId, setAlbumId] = useState('');
  const [layout, setLayout] = useState<VisualCollection>();
  const [layoutName, setLayoutName] = useState('');
  const [visibility, setVisibility] = useState<VisualCollection['visibility']>('private');
  const [existingIds, setExistingIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState<string>();
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
        const [library, content, feeds, groups] = await Promise.all([
          apiFetch('/api/visual/assets'), apiFetch('/api/posts'),
          apiFetch('/api/visual/collections?kind=feed'), apiFetch('/api/visual/collections?kind=album'),
        ]);
        if (!library.ok) throw new Error(await readError(library));
        if (!content.ok) throw new Error(await readError(content));
        const { assets } = await library.json() as { assets: VisualAsset[] };
        const { posts } = await content.json() as { posts: PostSummary[] };
        if (!alive) return;
        if (!feeds.ok) throw new Error(await readError(feeds));
        if (!groups.ok) throw new Error(await readError(groups));
        setAssets(assets);
        setLayouts((await feeds.json()).collections);
        setAlbums((await groups.json()).collections);
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
    if (layout) return;
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

  function openLayout(next?: VisualCollection) {
    setLayout(next);
    setLayoutName(next?.name ?? '');
    setVisibility(next?.visibility ?? 'private');
    setExistingIds(next?.items.filter((item) => item.existingFeed).map((item) => item.assetId) ?? []);
    setIds(next?.items.map((item) => item.assetId) ?? savedPlan(storageKey));
    setNotice('');
    setError('');
  }

  async function saveLayout(copy = false) {
    const current = copy ? undefined : layout;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/visual/collections${current ? `?id=${current.id}` : ''}`, { method: 'POST', body: {
        kind: 'feed', name: copy ? `${layoutName.slice(0, 72)} copy` : layoutName,
        visibility: copy ? 'private' : visibility, revision: current?.revision,
        items: planned.map((item) => ({ assetId: item.id, existingFeed: existingIds.includes(item.id) })),
      } });
      if (!response.ok) {
        if (response.status === 409) {
          const fresh = await apiFetch('/api/visual/collections?kind=feed');
          if (fresh.ok) setLayouts((await fresh.json()).collections);
        }
        throw new Error(await readError(response));
      }
      const result = await response.json() as VisualCollection;
      setLayouts((items) => [...items.filter((item) => item.id !== result.id), result]);
      openLayout(result);
      setNotice('Layout saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the layout.');
    } finally { setSaving(false); }
  }

  function drop(targetId: string) {
    if (!dragging || dragging === targetId) return;
    const from = ids.indexOf(dragging);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const ordered = ids.filter((id) => id !== dragging);
    ordered.splice(to, 0, dragging);
    save(ordered);
    setDragging(undefined);
  }

  const planned = ids.flatMap((id) => assets.find((item) => item.id === id) ?? []);
  const album = albums.find((item) => item.id === albumId);
  const available = assets.filter((item) => !ids.includes(item.id) && (!album || album.items.some((photo) => photo.assetId === item.id)));
  const editable = !layout || layout.editable;

  return <div className="space-y-5">
    <header>
      <h1 className="text-4xl font-semibold">Feed Preview</h1>
      <p className="mt-1 text-sm text-studio-muted">Arrange an Instagram grid alongside photos manually recorded as posted. Save a named layout to revisit it on another device. Feed Preview does not connect to Instagram.</p>
    </header>
    {error && <Alert kind="error">{error}</Alert>}
    {storageError && <Alert kind="info">{storageError}</Alert>}
    {notice && <Alert kind="success">{notice}</Alert>}
    <Card title="Saved layouts">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Open layout
          <select className={inputClass} value={layout?.id ?? ''} onChange={(event) => openLayout(layouts.find((entry) => entry.id === event.target.value))}>
            <option value="">New layout / browser draft</option>
            {layouts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.visibility}</option>)}
          </select>
        </label>
        {layout && <button className={secondaryButtonClass} onClick={() => openLayout(layouts.find((entry) => entry.id === layout.id))}>Reload saved layout</button>}
        {editable && <label className="text-sm font-semibold">Layout name
          <input className={inputClass} value={layoutName} maxLength={80} onChange={(event) => setLayoutName(event.target.value)} />
        </label>}
        {editable && <CollectionVisibility value={visibility} onChange={setVisibility} />}
        {editable && <button className={buttonClass} disabled={saving || !layoutName.trim()} onClick={() => void saveLayout()}>Save layout</button>}
        {layout && <button className={secondaryButtonClass} disabled={saving || !layoutName.trim()} onClick={() => void saveLayout(true)}>Save a private copy</button>}
      </div>
    </Card>
    <Card title="Build a grid">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Album
          <select className={inputClass} value={albumId} onChange={(event) => { setAlbumId(event.target.value); setPick(''); }}>
            <option value="">All available photos</option>
            {albums.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Photo from your library
          <select className={inputClass} value={pick} onChange={(event) => setPick(event.target.value)}>
            <option value="">Choose a photo</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <button className={buttonClass} disabled={!editable || !pick || planned.length >= 24} onClick={() => { save([...planned.map((item) => item.id), pick]); setPick(''); }}>Add to plan</button>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={includePublished} onChange={(event) => setIncludePublished(event.target.checked)} /> Show recorded posts
        </label>
      </div>
    </Card>
    {loading && <p role="status" className="text-sm text-studio-muted">Loading photos…</p>}
    {!loading && !planned.length && (!includePublished || !published.length)
      && <p className="text-sm text-studio-muted">Choose a library photo to start the grid.</p>}
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {planned.map((item, index) => <article key={item.id} draggable={editable} onDragStart={() => setDragging(item.id)}
        onDragEnd={() => setDragging(undefined)} onDragOver={(event) => { if (editable && dragging) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); if (editable) drop(item.id); }} className="min-w-0 overflow-hidden rounded-md border border-studio-linen bg-studio-pearl">
        <FeedImage tile={{ id: item.id, label: item.label, endpoint: `/api/visual/assets/${item.id}/image?size=thumb` }} />
        <div className="p-2">
          <p className="text-xs font-semibold text-studio-muted">{existingIds.includes(item.id) ? 'Manually supplied existing feed' : 'Planned'}</p>
          <p className="truncate text-sm">{item.label}</p>
          <Link className="text-xs underline" to={`/visual?asset=${item.id}`}>Open image editor</Link>
          {editable && <label className="mt-1 flex gap-1 text-xs">
            <input type="checkbox" checked={existingIds.includes(item.id)} onChange={(event) => setExistingIds((current) => event.target.checked
              ? [...current, item.id] : current.filter((id) => id !== item.id))} /> Existing feed photo
          </label>}
          {editable && <div className="mt-2 flex flex-wrap gap-1">
            <button className={`${secondaryButtonClass} !px-2 !py-1`} aria-label={`Move ${item.label} earlier`} disabled={index === 0} onClick={() => move(item.id, -1)}>←</button>
            <button className={`${secondaryButtonClass} !px-2 !py-1`} aria-label={`Move ${item.label} later`} disabled={index === planned.length - 1} onClick={() => move(item.id, 1)}>→</button>
            <button className="px-1 text-xs underline" aria-label={`Remove ${item.label} from plan`} onClick={() => save(ids.filter((id) => id !== item.id))}>Remove</button>
          </div>}
          {editable && assets.some((asset) => asset.parentId === item.id && !ids.includes(asset.id)) && <label className="mt-2 block text-xs">Replace with edited copy
            <select className={inputClass} value="" onChange={(event) => {
              const replacement = event.target.value;
              if (!replacement) return;
              save(ids.map((id) => id === item.id ? replacement : id));
              setExistingIds((current) => current.map((id) => id === item.id ? replacement : id));
            }}>
              <option value="">Keep current</option>
              {assets.filter((asset) => asset.parentId === item.id && !ids.includes(asset.id)).map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
            </select>
          </label>}
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
