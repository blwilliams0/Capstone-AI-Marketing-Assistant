import { useEffect, useState } from 'react';
import type { VisualAsset, VisualCollection } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, inputClass, secondaryButtonClass } from '../ui';

export function CollectionVisibility({ value, onChange, allowPrivate = true }: {
  allowPrivate?: boolean;
  value: VisualCollection['visibility'];
  onChange: (value: VisualCollection['visibility']) => void;
}) {
  const { me } = useAuth();
  return <label className="text-sm font-semibold">Visibility
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value as VisualCollection['visibility'])}>
      {allowPrivate && <option value="private">Private to me</option>}
      <option value="team">Restaurant team</option>
      {me?.role === 'admin' && <option value="management">Management only</option>}
    </select>
  </label>;
}

export function AlbumManager({ assets, onFilter, initiallyOpen }: { initiallyOpen?: boolean; assets: VisualAsset[]; onFilter: (ids: string[] | null) => void }) {
  const { apiFetch, me } = useAuth();
  const [albums, setAlbums] = useState<VisualCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [album, setAlbum] = useState<VisualCollection>();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<VisualCollection['visibility']>('private');
  const [ids, setIds] = useState<string[]>([]);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void apiFetch('/api/visual/collections?kind=album').then(async (response) => {
      if (!response.ok) throw new Error(await readError(response));
      const { collections } = await response.json() as { collections: VisualCollection[] };
      if (active) setAlbums(collections);
    }).catch((failure: Error) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiFetch]);

  function select(value?: VisualCollection) {
    setAlbum(value);
    setName(value?.name ?? '');
    setVisibility(value?.visibility ?? 'private');
    setIds(value?.items.map((item) => item.assetId) ?? []);
    setFiltering(false);
    setError('');
    onFilter(null);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/visual/collections${album ? `?id=${album.id}` : ''}`, {
        method: 'POST', body: {
          kind: 'album', name, visibility, revision: album?.revision,
          items: ids.map((assetId) => ({ assetId })),
        },
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = await response.json() as VisualCollection;
      setAlbums((current) => [...current.filter((item) => item.id !== updated.id), updated]);
      select(updated);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the album.');
    } finally { setBusy(false); }
  }

  async function archive(value: VisualCollection) {
    if (!window.confirm(`Archive ${value.name}? Its photo files will remain in the library, and access granted only by this album will end.`)) return;
    setError('');
    setBusy(true);
    try {
      const response = await apiFetch(`/api/visual/collections/${value.id}/archive`, { method: 'POST', body: { revision: value.revision } });
      if (!response.ok) throw new Error(await readError(response));
      setAlbums((current) => current.filter((item) => item.id !== value.id));
      select();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  const sharedPhotoIds = new Set(albums.filter((item) => !item.restaurantDefault
    && (item.visibility === 'team' || (visibility === 'management' && item.visibility === 'management')))
    .flatMap((item) => item.items.map((entry) => entry.assetId)));

  return <details open={initiallyOpen || undefined} id="albums" className="mb-4 rounded-lg border border-studio-linen bg-studio-cream p-3">
    <summary className="cursor-pointer font-semibold">Albums</summary>
    <div className="mt-3 space-y-3">
      {loading && <p role="status">Loading albums…</p>}
      {error && <Alert kind="error">{error}</Alert>}
      <div className="flex justify-end">
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => select()}>Create Album</button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {albums.map((item) => <li key={item.id}><button type="button" aria-pressed={album?.id === item.id} disabled={busy}
          className={`w-full rounded-md border p-3 text-left ${album?.id === item.id ? 'border-studio-slate bg-studio-ivory' : 'border-studio-linen bg-studio-pearl hover:border-studio-taupe'}`}
          onClick={() => { select(item); onFilter(item.items.map((photo) => photo.assetId)); setFiltering(true); }}>
          <span className="block text-sm font-semibold">{item.name}</span>
          <span className="text-sm text-studio-muted">{item.items.length} {item.items.length === 1 ? 'photo' : 'photos'} · {item.visibility === 'team' ? 'Restaurant team' : item.visibility === 'management' ? 'Management only' : 'Private'}</span>
        </button></li>)}
      </ul>
      {album && <button className={secondaryButtonClass} type="button" onClick={() => {
        onFilter(filtering ? null : album.items.map((item) => item.assetId));
        setFiltering(!filtering);
      }}>{filtering ? 'Show all photos' : 'Show photos in this album'}</button>}
      {album && me?.role === 'admin' && (album.editable || album.visibility !== 'private') && <button type="button"
        className={secondaryButtonClass} disabled={busy} onClick={() => void archive(album)}>Archive album</button>}
      {(!album || album.editable) && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm font-semibold">Album name
            <input className={inputClass} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} />
          </label>
          <CollectionVisibility allowPrivate={!album?.restaurantDefault} value={visibility} onChange={setVisibility} />
        </div>
        {album?.restaurantDefault && <p className="text-sm text-studio-muted">Add photos already shared through another album. Their underlying access still applies.</p>}
        {!album?.restaurantDefault && visibility !== 'private' && <p className="text-sm text-studio-muted">Saving shares the photos you own with this audience. Removing a photo leaves its original file intact.</p>}
        <fieldset className="max-h-40 space-y-1 overflow-y-auto">
          <legend className="text-sm font-semibold">Photos in this album</legend>
          {assets.filter((asset) => ids.includes(asset.id) || (album?.restaurantDefault ? sharedPhotoIds.has(asset.id) : visibility === 'private' || asset.owned !== false)).map((asset) => (
            <label className="flex gap-2 text-sm" key={asset.id}>
              <input type="checkbox" checked={ids.includes(asset.id)} onChange={(event) => setIds((current) => event.target.checked
                ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /> {asset.label}
            </label>
          ))}
        </fieldset>
        <button className={buttonClass} disabled={busy || !name.trim()}>Save album</button>
      </form>}
    </div>
  </details>;
}
