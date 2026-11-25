import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { VisualAsset, VisualStandard } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, Card, inputClass, secondaryButtonClass } from '../ui';
import { neutralRecipe, presets } from './render';

const classes = { on_brand: 'On-brand', off_brand: 'Off-brand', adjust: 'On-brand with adjustments', inspiration: 'Inspiration only' };

export function VisualStandards({ propose = false }: { propose?: boolean }) {
  const { me, apiFetch } = useAuth();
  const [standards, setStandards] = useState<VisualStandard[]>([]);
  const [assets, setAssets] = useState<VisualAsset[]>([]);
  const [kind, setKind] = useState<'reference' | 'preset'>('reference');
  const [revision, setRevision] = useState<VisualStandard>();
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [category, setCategory] = useState('');
  const [assetId, setAssetId] = useState('');
  const [classification, setClassification] = useState<keyof typeof classes>('on_brand');
  const [recipe, setRecipe] = useState(neutralRecipe);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = me?.capabilities.includes('brand.approve') ?? false;
  const canRead = me?.capabilities.includes('content.draft') ?? false;
  const canPropose = propose && me?.capabilities.includes('knowledge.propose');

  const load = useCallback(async () => {
    const response = await apiFetch('/api/visual/standards');
    if (!response.ok) throw new Error(await readError(response));
    setStandards((await response.json()).standards);
  }, [apiFetch]);

  useEffect(() => {
    if (canRead) void load().catch((failure: Error) => setError(failure.message));
    if (canPropose) void apiFetch('/api/visual/assets').then(async (response) => {
      if (response.ok) setAssets((await response.json()).assets);
    }).catch(() => {});
  }, [apiFetch, canPropose, canRead, load]);

  function revise(item: VisualStandard) {
    setRevision(item);
    setKind(item.kind);
    setTitle(item.title);
    setRationale(item.rationale);
    setCategory(item.category);
    setAssetId(item.assetId ?? '');
    setClassification(item.classification ?? 'on_brand');
    setRecipe(item.recipe ?? neutralRecipe);
  }

  async function write(kindOfWrite: 'proposal' | 'approve' | 'reject', item?: VisualStandard) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const path = item ? `/api/knowledge/versions/${item.versionId}/${kindOfWrite}` : '/api/visual/standards';
      const core = { kind, itemId: revision?.itemId, title, rationale, category };
      const body = item
        ? kindOfWrite === 'reject' ? { note: 'Rejected from Visual Standards.' } : { confirmSelfApproval: true }
        : kind === 'preset' ? { ...core, recipe } : { ...core, assetId, classification };
      const response = await apiFetch(path, { method: 'POST', body });
      if (!response.ok) throw new Error(await readError(response));
      if (!item) {
        setRevision(undefined); setTitle(''); setRationale(''); setCategory('');
      }
      setMessage(item ? 'Decision recorded.' : 'Proposal saved for management review.');
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the visual standard.');
    } finally { setBusy(false); }
  }

  async function setImagePermission(item: VisualStandard, allowed: boolean) {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/visual/standards/${item.versionId}/image-permission`, { method: 'POST', body: { allowed } });
      if (!response.ok) throw new Error(await readError(response));
      await load();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  if (!canRead) return null;
  return <Card title="Visual Standards">
    {error && <Alert kind="error">{error}</Alert>}
    {message && <Alert kind="success">{message}</Alert>}
    {!standards.length && <p className="text-sm text-studio-muted">No visual standards are available yet.</p>}
    <ul className="divide-y divide-studio-linen">
      {standards.filter((item) => propose || item.status === 'approved').map((item) => <li key={item.versionId} className="space-y-1 py-2">
        <p className="font-semibold">{item.title} · {item.kind === 'preset' ? 'Preset' : classes[item.classification ?? 'inspiration']}</p>
        <p className="text-xs text-studio-muted">{item.category} · version {item.version} · {item.status}</p>
        <p className="text-sm">{item.rationale}</p>
        {item.assetId && <Link className="text-sm underline" to={`/visual?asset=${item.assetId}`}>Open reference image</Link>}
        {canPropose && (item.kind === 'reference' || admin) && <div className="flex flex-wrap gap-2 pt-1">
          {item.status === 'approved' && item.classification === 'on_brand' && assets.some((asset) => asset.id === item.assetId && asset.owned !== false) &&
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => {
              if (item.liveImageAllowed || window.confirm('Confirm that you have permission to share this exact photo with the configured AI provider and it contains no identifiable people or private information.')) {
                void setImagePermission(item, !item.liveImageAllowed);
              }
            }}>{item.liveImageAllowed ? 'Revoke reference AI permission' : 'Allow reference in live AI evaluation'}</button>}
          <button className={secondaryButtonClass} onClick={() => revise(item)}>Propose revision</button>
          {admin && item.status === 'proposed' && <>
            <button className={buttonClass} disabled={busy} onClick={() => {
              if (window.confirm('Approve this exact version? This also confirms self-approval when applicable.')) void write('approve', item);
            }}>Approve version</button>
            <button className={secondaryButtonClass} disabled={busy} onClick={() => void write('reject', item)}>Reject</button>
          </>}
        </div>}
      </li>)}
    </ul>
    {canPropose && <form className="mt-4 space-y-2 border-t border-studio-linen pt-3" onSubmit={(event) => { event.preventDefault(); void write('proposal'); }}>
      <h3 className="font-semibold">{revision ? `Revise ${revision.title}` : 'Propose a visual standard'}</h3>
      {revision && <button className={secondaryButtonClass} type="button" onClick={() => { setRevision(undefined); setTitle(''); setRationale(''); setCategory(''); }}>Start a new standard</button>}
      {admin && !revision && <label className="block text-sm">Standard type
        <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value === 'preset' ? 'preset' : 'reference')}>
          <option value="reference">Photo reference</option><option value="preset">Photography preset</option>
        </select>
      </label>}
      <label className="block text-sm">Name<input className={inputClass} required maxLength={100} value={title} readOnly={!!revision} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block text-sm">Category or intended context<input className={inputClass} required maxLength={60} value={category} onChange={(event) => setCategory(event.target.value)} /></label>
      <label className="block text-sm">Rationale<textarea className={inputClass} required maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
      {kind === 'reference' ? <>
        <label className="block text-sm">Photo from a team album you own
          <select className={inputClass} required value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            <option value="">Choose photo</option>
            {assets.filter((asset) => asset.owned !== false).map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">Classification
          <select className={inputClass} value={classification} onChange={(event) => setClassification(event.target.value as keyof typeof classes)}>
            {Object.entries(classes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </> : <>
        <label className="block text-sm">Start from a practice look
          <select className={inputClass} defaultValue="" onChange={(event) => setRecipe({ ...neutralRecipe, ...presets.find((preset) => preset.name === event.target.value)?.edits })}>
            <option value="">Custom / neutral</option>{presets.map((preset) => <option key={preset.name}>{preset.name}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['exposure', 'warmth', 'contrast', 'saturation', 'highlights', 'shadows', 'sharpness'] as const).map((field) =>
            <label key={field} className="text-sm capitalize">{field}
              <input className={inputClass} type="number" required step="0.01" min={field === 'sharpness' ? 0 : -1} max={1} value={recipe[field]}
                onChange={(event) => setRecipe((current) => ({ ...current, [field]: Number(event.target.value) }))} />
            </label>)}
        </div>
      </>}
      <button className={buttonClass} disabled={busy}>Save proposal</button>
    </form>}
  </Card>;
}
