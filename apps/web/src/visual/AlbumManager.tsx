import { useEffect, useState } from 'react';
import type { VisualAsset, VisualCollection } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, inputClass, secondaryButtonClass } from '../ui';

export function CollectionVisibility({ value, onChange }: {
  value: VisualCollection['visibility'];
  onChange: (value: VisualCollection['visibility']) => void;
}) {
  const { me } = useAuth();
  return <label className="text-sm font-semibold">Visibility
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value as VisualCollection['visibility'])}>
      <option value="private">Private to me</option>
      <option value="team">Restaurant team</option>
      {me?.role === 'admin' && <option value="management">Management only</option>}
    </select>
  </label>;
}

export function AlbumManager({ assets, onFilter }: { assets: VisualAsset[]; onFilter: (ids: string[] | null) => void }) {
  const { apiFetch } = useAuth();
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

  return <details id="albums" className="mb-4 rounded-lg border border-studio-linen bg-studio-cream p-3">
    <summary className="cursor-pointer font-semibold">Albums</summary>
    <div className="mt-3 space-y-3">
      {loading && <p role="status">Loading albums…</p>}
      {error && <Alert kind="error">{error}</Alert>}
      <label className="block text-sm font-semibold">Browse album
        <select className={inputClass} value={album?.id ?? ''} onChange={(event) => select(albums.find((item) => item.id === event.target.value))}>
          <option value="">New album</option>
          {albums.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.visibility}</option>)}
        </select>
      </label>
      {album && <button className={secondaryButtonClass} type="button" onClick={() => {
        onFilter(filtering ? null : album.items.map((item) => item.assetId));
        setFiltering(!filtering);
      }}>{filtering ? 'Show all photos' : 'Show photos in this album'}</button>}
      {(!album || album.editable) && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm font-semibold">Album name
            <input className={inputClass} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} />
          </label>
          <CollectionVisibility value={visibility} onChange={setVisibility} />
        </div>
        {visibility !== 'private' && <p className="text-sm text-studio-muted">Saving shares the photos you own with this audience. Removing a photo leaves its original file intact.</p>}
        <fieldset className="max-h-40 space-y-1 overflow-y-auto">
          <legend className="text-sm font-semibold">Photos in this album</legend>
          {assets.filter((asset) => visibility === 'private' || asset.owned !== false || ids.includes(asset.id)).map((asset) => (
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
