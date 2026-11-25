import { useCallback, useEffect, useRef, useState } from 'react';
import type { VisualRecipe, VisualEditResult, VisualStandard } from '@the-pocket/shared';
import { ThinkingBowl } from '../advisor/Composer';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, inputClass, secondaryButtonClass } from '../ui';
import { exportPhoto, neutralRecipe, presets, renderPhoto } from './render';

const controls = [
  ['exposure', 'Exposure'], ['warmth', 'Warmth'], ['contrast', 'Contrast'], ['saturation', 'Saturation'],
  ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['sharpness', 'Sharpness'],
] as const;

export function PhotoEditor({ url, save, assetId, initialRecipe, initialPrompt, onAutoEdit, adviceAssetId }: {
  url: string;
  assetId: string;
  initialRecipe?: VisualRecipe;
  initialPrompt?: string;
  onAutoEdit?: () => void;
  adviceAssetId?: string;
  save?: (image: Blob, edits: VisualRecipe, assetId: string) => Promise<void>;
}) {
  const { apiFetch, me } = useAuth();
  const [recipe, setRecipe] = useState(initialRecipe ?? neutralRecipe);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [previousRequests, setPreviousRequests] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState(Boolean(initialPrompt));
  const [advice, setAdvice] = useState<VisualEditResult>();
  const [asking, setAsking] = useState(false);
  const [section, setSection] = useState<'Adjust' | 'Filters' | 'Crop'>('Adjust');
  const [format, setFormat] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [approved, setApproved] = useState<VisualStandard[]>([]);
  const [preset, setPreset] = useState('');
  const [intensity, setIntensity] = useState(100);
  const [before, setBefore] = useState(false);
  const [image, setImage] = useState<HTMLImageElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<{ url: string; recipe: VisualRecipe; format: string }>();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const photo = new Image();
    photo.onload = () => setImage(photo);
    photo.onerror = () => setError('Could not decode the preview.');
    photo.src = url;
    return () => { photo.onload = null; photo.onerror = null; };
  }, [url]);

  useEffect(() => {
    if (!image || !canvas.current) return;
    const frame = requestAnimationFrame(() => {
      if (canvas.current) renderPhoto(canvas.current, image, before ? neutralRecipe : recipe, 900);
    });
    return () => cancelAnimationFrame(frame);
  }, [image, recipe, before]);

  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.url); }, [prepared]);

  useEffect(() => {
    let active = true;
    void apiFetch('/api/visual/standards').then(async (response) => {
      if (!response.ok) return;
      const { standards } = await response.json() as { standards: VisualStandard[] };
      if (active) setApproved(standards.filter((item) => item.kind === 'preset' && item.status === 'approved' && item.recipe));
    }).catch(() => {});
    return () => { active = false; };
  }, [apiFetch]);

  function applyPreset(name: string, strength: number) {
    setPreset(name);
    setIntensity(strength);
    const approvedPreset = approved.find((item) => item.versionId === name);
    const practice = presets.find((item) => item.name === name);
    const edits = Object.fromEntries(controls.map(([key]) => [key,
      (approvedPreset?.recipe?.[key] ?? (practice?.edits as Partial<VisualRecipe> | undefined)?.[key] ?? 0) * strength / 100,
    ]));
    setRecipe({ ...neutralRecipe, crop: recipe.crop, rotation: recipe.rotation, presetVersionId: approvedPreset?.versionId,
      ...edits,
    });
  }

  async function finish(mode: 'download' | 'save') {
    if (!image) return;
    setBusy(true);
    setError('');
    try {
      const blob = await exportPhoto(image, recipe, format);
      if (mode === 'save') await save?.(blob, recipe, assetId);
      else setPrepared({ url: URL.createObjectURL(blob), recipe, format });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not finish the image.');
    } finally {
      setBusy(false);
    }
  }

  const autoAsked = useRef(false);
  const askForEdit = useCallback(async () => {
    setAsking(true);
    setError('');
    setAdvice(undefined);
    try {
      const response = await apiFetch('/api/visual/edit-advice', {
        method: 'POST', body: { assetId: adviceAssetId ?? assetId, request: prompt, currentRecipe: recipe, privacyConfirmed: privacy, previousRequests },
      });
      if (!response.ok) throw new Error(await readError(response));
      setAdvice(await response.json() as VisualEditResult);
      setPreviousRequests((prior) => [...prior, prompt.trim().slice(0, 600)].slice(-3));
      setPrompt('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not get practice editing advice.');
    } finally { setAsking(false); }
  }, [apiFetch, assetId, adviceAssetId, prompt, recipe, privacy, previousRequests]);

  useEffect(() => {
    if (initialPrompt && !autoAsked.current) {
      autoAsked.current = true;
      onAutoEdit?.();
      void askForEdit();
    }
  }, [initialPrompt, askForEdit, onAutoEdit]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-3">
        <div className="grid min-h-56 place-items-center rounded-md bg-studio-slate p-4">
          <canvas ref={canvas} aria-label={before ? 'Before adjustments' : 'After adjustments'} role="img" className="max-h-[60vh] max-w-full object-contain" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButtonClass} aria-pressed={before} onClick={() => setBefore(!before)}>{before ? 'Show adjustments' : 'Show before'}</button>
          <label className="text-sm">Export format
            <select className={inputClass} value={format} onChange={(event) => setFormat(event.target.value === 'image/jpeg' ? 'image/jpeg' : 'image/png')}>
              <option value="image/png">PNG</option><option value="image/jpeg">JPEG</option>
            </select>
          </label>
          <button className={secondaryButtonClass} disabled={!image || busy} onClick={() => void finish('download')}>Prepare {format === 'image/png' ? 'PNG' : 'JPEG'}</button>
          {prepared?.recipe === recipe && prepared.format === format && <a className={secondaryButtonClass} href={prepared.url} download={format === 'image/png' ? 'pocket-photo.png' : 'pocket-photo.jpg'}>Download image</a>}
          {save && <button className={buttonClass} disabled={!image || busy} onClick={() => void finish('save')}>Save edited copy</button>}
        </div>
        {__MOCK_AUTH__ && me?.capabilities.includes('assistant.use') && <form className="space-y-2 rounded-md border border-studio-linen p-3" onSubmit={(event) => { event.preventDefault(); void askForEdit(); }}>
          <label className="block font-semibold">Ask for an edit
            <textarea className={inputClass} value={prompt} maxLength={2000} placeholder="Make this a little warmer…" onChange={(event) => setPrompt(event.target.value)} />
          </label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} /> I have permission to use this image and it contains no identifiable private information.</label>
          <button className={buttonClass} disabled={asking || !privacy || prompt.trim().length < 3}>Suggest practice adjustments</button>{asking && <ThinkingBowl label="AI Advisor is preparing photo advice" />}
          {advice && <div role="status" className="space-y-2 text-sm">
            <p>{advice.rationale}</p>
            <button type="button" className={secondaryButtonClass} onClick={() => { setRecipe(advice.recipe); setBefore(false); setPreset(''); setAdvice(undefined); }}>Preview suggested adjustments</button>
          </div>}
        </form>}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
      <fieldset className="space-y-3" disabled={asking}>
        <legend className="sr-only">Manual editing controls</legend>
        <div className="flex flex-wrap gap-1" aria-label="Editor sections">
          {(['Adjust', 'Filters', 'Crop'] as const).map((item) => <button key={item} className={secondaryButtonClass} aria-pressed={section === item} onClick={() => setSection(item)}>{item}</button>)}
        </div>
        {section === 'Filters' && <><label className="block text-sm font-semibold">Photography preset
          <select className={inputClass} value={preset} onChange={(event) => applyPreset(event.target.value, intensity)}>
            <option value="">None / manual</option>
            <optgroup label="Practice presets">{presets.map(({ name }) => <option key={name}>{name}</option>)}</optgroup>
            {approved.length > 0 && <optgroup label="Management-approved presets">
              {approved.map((item) => <option key={item.versionId} value={item.versionId}>{item.title} · v{item.version}</option>)}
            </optgroup>}
          </select>
        </label>
        {preset && <label className="block text-sm">Preset intensity {intensity}%
          <input className="block w-full accent-studio-slate" type="range" min="0" max="100" value={intensity} onChange={(event) => applyPreset(preset, Number(event.target.value))} />
        </label>}
        </>}
        {section === 'Adjust' && controls.map(([key, label]) => (
          <label key={key} className="block text-sm">{label} <span className="float-right tabular-nums">{Math.round(recipe[key] * 100)}</span>
            <input className="block w-full accent-studio-slate" type="range" min={key === 'sharpness' ? 0 : -1} max="1" step="0.01"
              value={recipe[key]} onChange={(event) => { setPreset(''); setRecipe({ ...recipe, [key]: Number(event.target.value) }); }} />
          </label>
        ))}
        {section === 'Crop' && <><button className={secondaryButtonClass} onClick={() => setRecipe({ ...recipe,
          rotation: (((recipe.rotation ?? 0) + 90) % 360) as VisualRecipe['rotation'],
        })}>Rotate 90°</button>
        <label className="block text-sm font-semibold">Center crop
          <select className={inputClass} value={recipe.crop} onChange={(event) => setRecipe({ ...recipe, crop: event.target.value as VisualRecipe['crop'] })}>
            <option value="original">Original ratio</option><option value="square">Square · 1:1</option>
            <option value="portrait">Portrait · 4:5</option><option value="landscape">Landscape · 3:2</option>
          </select>
        </label>
        </>}
        <button className={secondaryButtonClass} onClick={() => { setPreset(''); setIntensity(100); setRecipe(neutralRecipe); setBefore(false); }}>Reset adjustments</button>
      </fieldset>
    </div>
  );
}
