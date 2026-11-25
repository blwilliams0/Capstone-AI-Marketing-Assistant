import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { VisualAsset, VisualCollection } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { secondaryButtonClass } from '../ui';

export const iconPaths = {
  plus: 'M12 5v14M5 12h14', photo: 'M3 4h18v16H3zM3 17l5-5 4 4 3-3 6 5M15 8h2',
  send: 'M12 19V5m-6 6 6-6 6 6', menu: 'M4 6h16M4 12h16M4 18h16',
  rail: 'M3 4h18v16H3zM9 4v16', focus: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
  home: 'M3 11l9-8 9 8v9h-6v-6H9v6H3z', chat: 'M4 4h16v12H9l-5 4zM8 8h8m-8 4h6',
  book: 'M4 4h14l2 2v14H4zM8 4v16m3-11h5m-5 4h5', grid: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  file: 'M5 3h10l4 4v14H5zM8 12h8m-8 4h8', calendar: 'M4 5h16v15H4zM4 9h16M8 3v4m8-4v4',
  check: 'm5 12 4 4L19 6', bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4',
  person: 'M4 20v-3a8 4 0 0 1 16 0v3M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
  exit: 'M9 4H4v16h5m4-13 5 5-5 5m-4-5h9',
};

export function StudioIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]} /></svg>;
}

export function ThinkingBowl({ label = 'AI Advisor is preparing a response' }: { label?: string }) {
  return <span role="status" className="grid size-10 place-items-center"><span className="sr-only">{label}</span>
    <svg aria-hidden="true" width="38" height="38" viewBox="0 0 40 40">
      <ellipse cx="20" cy="22" rx="15" ry="5" fill="#D6C7AA" stroke="#4E5156" />
      <g className="studio-spoon" stroke="#655644" strokeWidth="2.8" strokeLinecap="round"><path d="M20 24 22 5" /><ellipse cx="19.8" cy="24" rx="3.3" ry="4.2" fill="#826E55" /></g>
      <path d="M5 22q3 15 15 15t15-15q-15 8-30 0Z" fill="#4E5156" stroke="#150C0C" strokeLinejoin="round" />
      <path d="M11 29q3 3 7 4" fill="none" stroke="#D6C7AA" strokeLinecap="round" />
    </svg>
  </span>;
}

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

export function Composer({ value, onChange, onSend, home, attachmentTools, pending, disabled, autoFocus, children }: {
  value: string; onChange: (value: string) => void; onSend: (value: string, photo?: VisualAsset) => void;
  home?: boolean; attachmentTools?: boolean; pending?: boolean; disabled?: boolean; autoFocus?: boolean; children?: ReactNode;
}) {
  const { apiFetch } = useAuth();
  const [picker, setPicker] = useState<'actions' | 'photos'>();
  const [photos, setPhotos] = useState<VisualAsset[]>([]);
  const [albums, setAlbums] = useState<VisualCollection[]>([]);
  const [album, setAlbum] = useState('');
  const [photo, setPhoto] = useState<VisualAsset>();
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const launchButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (autoFocus) textarea.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (!photo) return;
    let active = true;
    let url: string | undefined;
    void apiFetch(`/api/visual/assets/${photo.id}/image?size=thumb`).then(async (res) => {
      if (!res.ok) return;
      const blob = await res.blob();
      if (active) { url = URL.createObjectURL(blob); setPreview(url); }
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [apiFetch, photo]);

  async function choosePhotos() {
    setPicker('photos');
    setLoading(true);
    setError('');
    try {
      const [assets, collections] = await Promise.all([apiFetch('/api/visual/assets'), apiFetch('/api/visual/collections?kind=album')]);
      if (!assets.ok || !collections.ok) throw new Error('Could not open the media library.');
      setPhotos((await assets.json()).assets);
      setAlbums((await collections.json()).collections);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }

  function attach(asset?: VisualAsset) {
    setPhoto(asset);
    setPreview('');
    setConfirmed(false);
    setPicker(undefined);
    textarea.current?.focus();
  }

  async function upload(file?: File) {
    if (!file || loading) return;
    setError('');
    if (!imageTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or WebP up to 10 MB.');
      return;
    }
    setLoading(true);
    try {
      const label = [...file.name.replace(/\.[^.]+$/, '')].slice(0, 95).join('') || 'Photo';
      const res = await apiFetch('/api/visual/assets', { method: 'POST', body: file,
        headers: { 'X-Photo-Id': crypto.randomUUID(), 'X-Photo-Label': encodeURIComponent(label) } });
      if (!res.ok) throw new Error(await readError(res));
      attach(await res.json() as VisualAsset);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }

  const blocked = disabled || pending || loading || value.trim().length < 3 || Boolean(photo && !confirmed);
  const activeAlbum = albums.find((entry) => entry.id === album);
  const send = () => {
    if (blocked) return;
    onSend(value.trim(), photo);
    if (photo) attach();
  };
  const tool = 'grid size-9 place-items-center rounded-full text-studio-muted hover:bg-studio-linen disabled:opacity-50';
  return <form className="relative rounded-[20px] border border-studio-ivory bg-studio-pearl p-3 sm:p-4"
    onSubmit={(event) => { event.preventDefault(); send(); }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && picker) { setPicker(undefined); launchButton.current?.focus(); }
    }}>
    <div className="relative">
      {home && !value && <span aria-hidden="true" className="pointer-events-none absolute left-1 top-1 text-studio-muted">What are we <em>cookin’</em> up today?</span>}
      <textarea ref={textarea} aria-label="Ask AI Advisor" placeholder={home ? undefined : 'Ask a marketing question…'}
        rows={3} maxLength={2000} value={value} onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }} className="block w-full resize-y bg-transparent px-1 py-1 text-base" />
    </div>
    {photo && <div className="my-2 flex flex-wrap items-center gap-2 text-sm">
      {preview && <img src={preview} alt="" className="size-12 rounded object-cover" />}
      <span className="break-all">{photo.label}</span>
      <button type="button" className="underline" onClick={() => attach()}>Remove photo</button>
      <label className="flex w-full items-start gap-2"><input className="mt-0.5 size-4 shrink-0" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I have permission to use this photo and it contains no identifiable private information.</label>
    </div>}
    {error && <p role="alert" className="my-2 text-sm text-studio-ink">{error}</p>}
    {loading && <p role="status" className="sr-only">Preparing photo selection</p>}
    <div className="relative mt-2 flex items-center gap-1">
      {attachmentTools && <>
        <input ref={fileInput} type="file" hidden accept={imageTypes.join(',')} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
        <button type="button" className={tool} aria-label="Add to prompt" title="Add to prompt" aria-expanded={picker === 'actions'} disabled={pending || loading}
          onClick={(event) => { launchButton.current = event.currentTarget; setPicker(picker === 'actions' ? undefined : 'actions'); }}><StudioIcon name="plus" /></button>
        <button type="button" className={tool} aria-label="Attach a photo" title="Attach a photo" aria-expanded={picker === 'photos'} disabled={pending || loading}
          onClick={(event) => { launchButton.current = event.currentTarget; if (picker === 'photos') setPicker(undefined); else void choosePhotos(); }}><StudioIcon name="photo" /></button>
      </>}
      {children}
      <span className="ml-auto text-sm font-semibold text-studio-muted">AI Advisor</span>
      {pending ? <ThinkingBowl /> : <button type="submit" aria-label="Send to AI Advisor" disabled={blocked}
        className="grid size-10 place-items-center rounded-full bg-studio-slate text-studio-pearl hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"><StudioIcon name="send" /></button>}
    </div>
    {picker && <div className="mt-2 space-y-2 rounded-xl border border-studio-ivory p-3 text-sm">
      <button type="button" className={secondaryButtonClass} disabled={loading} onClick={() => fileInput.current?.click()}>Upload photo</button>
      {picker === 'actions' ? <button type="button" className={`${secondaryButtonClass} ml-2`} disabled={loading} onClick={() => void choosePhotos()}>Choose from Media Library</button> :
        <>
          <label className="block">Album <select className="ml-2 max-w-full rounded border border-studio-ivory p-1" value={album} onChange={(event) => setAlbum(event.target.value)}>
            <option value="">All accessible photos</option>
            {albums.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select></label>
          {!loading && <ul className="max-h-44 overflow-auto">
            {photos.filter((entry) => !activeAlbum || activeAlbum.items.some((item) => item.assetId === entry.id)).map((entry) =>
              <li key={entry.id}><button type="button" className="w-full rounded p-2 text-left hover:bg-studio-linen" onClick={() => attach(entry)}>{entry.label}</button></li>)}
          </ul>}
        </>}
    </div>}
  </form>;
}
