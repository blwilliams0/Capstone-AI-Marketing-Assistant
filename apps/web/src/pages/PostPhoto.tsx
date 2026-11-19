import { useEffect, useRef, useState } from 'react';
import { readError, supabase, useAuth } from '../auth';
import { Alert, secondaryButtonClass } from '../ui';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Shows a post version's photo through a short-lived private link, and lets staff add or replace
 * it. A new photo is a new version, so an approved post needs approving again.
 */
export function PostPhoto({
  itemId,
  versionId,
  sha256,
  canEdit,
  approved,
  onChanged,
}: {
  itemId: string;
  versionId: string;
  sha256: string | null;
  canEdit: boolean;
  approved: boolean;
  onChanged?: () => Promise<void>;
}) {
  const { apiFetch } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUrl(null);
    if (!sha256) return;
    let alive = true;
    void apiFetch(`/api/posts/${itemId}/media?versionId=${versionId}`).then(async (res) => {
      if (!alive) return;
      if (res.ok) setUrl(((await res.json()) as { url: string }).url);
      else setError(await readError(res));
    });
    return () => {
      alive = false;
    };
  }, [apiFetch, itemId, versionId, sha256]);

  async function upload(file: File) {
    setError(null);
    if (!ACCEPT.split(',').includes(file.type)) return setError('Choose a JPEG, PNG or WebP photo.');
    if (file.size > MAX_BYTES) return setError('Photos must be 10 MB or smaller.');
    if (approved && !window.confirm('This post is approved. Adding a photo creates a new version that needs approving again. Continue?')) return;
    if (!supabase) return setError('Photo upload is not available in this setup.');
    setBusy(true);
    try {
      const link = await apiFetch(`/api/posts/${itemId}/media/upload-link`, { method: 'POST', body: { contentType: file.type } });
      if (!link.ok) return setError(await readError(link));
      const { bucket, path, token } = (await link.json()) as { bucket: string; path: string; token: string };
      const { error: upErr } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (upErr) return setError('The upload did not finish. Check your connection and try again.');
      const attach = await apiFetch(`/api/posts/${itemId}/media`, { method: 'POST', body: { path } });
      if (!attach.ok) return setError(await readError(attach));
      await onChanged?.();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!window.confirm(approved ? 'Remove the photo? The post will need approving again.' : 'Remove the photo?')) return;
    setBusy(true);
    const res = await apiFetch(`/api/posts/${itemId}/media/remove`, { method: 'POST', body: {} });
    setBusy(false);
    if (res.ok) await onChanged?.();
    else setError(await readError(res));
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Photo</h3>
      {sha256 ? (
        url ? (
          <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
            <img src={url} alt="Photo for this post" className="max-h-72 rounded-md ring-1 ring-stone-200" />
          </a>
        ) : (
          <p className="text-xs text-stone-500">Loading photo…</p>
        )
      ) : (
        <p className="text-xs text-stone-500">No photo attached{canEdit ? ' yet. Take it using the photo plan, then add it here so it is approved with the text.' : '.'}</p>
      )}
      {sha256 && (
        <p className="text-xs text-stone-500">
          Photo fingerprint <code>{sha256.slice(0, 12)}</code>
          {url && (
            <>
              {' '}
              ·{' '}
              <a href={url} download className="underline">
                download
              </a>
            </>
          )}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <button className={secondaryButtonClass} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : sha256 ? 'Replace photo' : 'Add a photo'}
          </button>
          {sha256 && (
            <button className={secondaryButtonClass} disabled={busy} onClick={() => void remove()}>
              Remove photo
            </button>
          )}
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}
