import { useEffect, useRef, useState } from 'react';
import type { VisualRecipe } from '@the-pocket/shared';
import { Alert, buttonClass, inputClass, secondaryButtonClass } from '../ui';
import { exportPhoto, neutralRecipe, presets, renderPhoto } from './render';

const controls = [
  ['exposure', 'Exposure'], ['warmth', 'Warmth'], ['contrast', 'Contrast'], ['saturation', 'Saturation'],
  ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['sharpness', 'Sharpness'],
] as const;

export function PhotoEditor({ url, save }: { url: string; save: (image: Blob, edits: VisualRecipe) => Promise<void> }) {
  const [recipe, setRecipe] = useState(neutralRecipe);
  const [preset, setPreset] = useState('');
  const [intensity, setIntensity] = useState(100);
  const [before, setBefore] = useState(false);
  const [image, setImage] = useState<HTMLImageElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<{ url: string; recipe: VisualRecipe }>();
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

  function applyPreset(name: string, strength: number) {
    setPreset(name);
    setIntensity(strength);
    const edits: Partial<Record<(typeof controls)[number][0], number>> = presets.find((item) => item.name === name)?.edits ?? {};
    setRecipe({ ...neutralRecipe, crop: recipe.crop,
      ...Object.fromEntries(Object.entries(edits).map(([field, value]) => [field, value * strength / 100])),
    });
  }

  async function finish(mode: 'download' | 'save') {
    if (!image) return;
    setBusy(true);
    setError('');
    try {
      const blob = await exportPhoto(image, recipe);
      if (mode === 'save') await save(blob, recipe);
      else setPrepared({ url: URL.createObjectURL(blob), recipe });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not finish the image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-3">
        <div className="grid min-h-56 place-items-center rounded-md bg-studio-slate p-4">
          <canvas ref={canvas} aria-label={before ? 'Before adjustments' : 'After adjustments'} role="img" className="max-h-[60vh] max-w-full object-contain" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButtonClass} aria-pressed={before} onClick={() => setBefore(!before)}>{before ? 'Show adjustments' : 'Show before'}</button>
          <button className={secondaryButtonClass} disabled={!image || busy} onClick={() => void finish('download')}>Prepare PNG</button>
          {prepared?.recipe === recipe && <a className={secondaryButtonClass} href={prepared.url} download="pocket-photo.png">Download PNG</a>}
          <button className={buttonClass} disabled={!image || busy} onClick={() => void finish('save')}>Save edited copy</button>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
      <div className="space-y-3">
        <label className="block text-sm font-semibold">Practice preset
          <select className={inputClass} value={preset} onChange={(event) => applyPreset(event.target.value, intensity)}>
            <option value="">None / manual</option>
            {presets.map(({ name }) => <option key={name}>{name}</option>)}
          </select>
        </label>
        {preset && <label className="block text-sm">Preset intensity {intensity}%
          <input className="block w-full accent-studio-slate" type="range" min="0" max="100" value={intensity} onChange={(event) => applyPreset(preset, Number(event.target.value))} />
        </label>}
        {controls.map(([key, label]) => (
          <label key={key} className="block text-sm">{label} <span className="float-right tabular-nums">{Math.round(recipe[key] * 100)}</span>
            <input className="block w-full accent-studio-slate" type="range" min={key === 'sharpness' ? 0 : -1} max="1" step="0.01"
              value={recipe[key]} onChange={(event) => { setPreset(''); setRecipe({ ...recipe, [key]: Number(event.target.value) }); }} />
          </label>
        ))}
        <label className="block text-sm font-semibold">Center crop
          <select className={inputClass} value={recipe.crop} onChange={(event) => setRecipe({ ...recipe, crop: event.target.value as VisualRecipe['crop'] })}>
            <option value="original">Original ratio</option><option value="square">Square · 1:1</option>
            <option value="portrait">Portrait · 4:5</option><option value="landscape">Landscape · 3:2</option>
          </select>
        </label>
        <button className={secondaryButtonClass} onClick={() => { setPreset(''); setIntensity(100); setRecipe(neutralRecipe); setBefore(false); }}>Reset adjustments</button>
      </div>
    </div>
  );
}
