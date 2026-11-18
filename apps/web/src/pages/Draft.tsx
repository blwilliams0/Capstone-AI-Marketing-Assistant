import { useState, type FormEvent } from 'react';
import { AUDIENCES, AUDIENCE_LABELS, CHANNELS, CHANNEL_LABELS, type DraftRequest, type DraftResponse } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export function Draft() {
  const { apiFetch } = useAuth();
  const [form, setForm] = useState<DraftRequest>({ audience: 'locals', channel: 'instagram', goal: '', topic: '' });
  const [result, setResult] = useState<DraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch('/api/drafts/generate', { method: 'POST', body: form });
    if (res.ok) setResult((await res.json()) as DraftResponse);
    else setError(await readError(res));
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create a post</h1>
        <p className="text-sm text-stone-600">
          The assistant drafts options from approved brand rules and facts. Drafts are suggestions: nothing is posted, and every post needs approval.
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Who is it for?</legend>
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map((a) => (
                <label key={a} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${form.audience === a ? 'border-stone-900 bg-stone-100' : 'border-stone-300'}`}>
                  <input type="radio" className="sr-only" name="audience" checked={form.audience === a} onChange={() => setForm({ ...form, audience: a })} />
                  {AUDIENCE_LABELS[a]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-medium">
            Where will it go?
            <select className={inputClass} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as DraftRequest['channel'] })}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            What should it achieve?
            <input
              className={inputClass}
              required
              minLength={3}
              maxLength={300}
              placeholder="e.g. Fill the patio on weeknights"
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
            />
          </label>
          <label className="block text-sm font-medium">
            What is it about? Include details the kitchen has confirmed.
            <textarea
              className={`${inputClass} min-h-24`}
              required
              minLength={3}
              maxLength={1000}
              placeholder="e.g. New fall menu starts Friday; braised short rib confirmed by Chef Mike"
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
            />
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          <button className={buttonClass} disabled={busy}>
            {busy ? 'Drafting…' : 'Draft options'}
          </button>
        </form>
      </Card>

      {result && (
        <div className="space-y-4">
          {result.provider === 'mock' && <Alert kind="info">Practice mode: these drafts are placeholders because no AI service is connected.</Alert>}
          {result.warnings.map((w, i) => (
            <Alert key={i} kind="error">
              {w}
            </Alert>
          ))}
          {result.options.map((o, i) => (
            <Card key={i} title={`Option ${i + 1}${o.angle ? `: ${o.angle}` : ''}`}>
              <p className="whitespace-pre-wrap rounded bg-stone-50 p-3 text-sm">{o.caption}</p>
              <p className="mt-1 text-xs text-stone-500">{o.caption.length.toLocaleString()} characters</p>
              {o.whyItFits && <p className="mt-3 text-sm"><span className="font-medium">Why it fits: </span>{o.whyItFits}</p>}
              <p className="mt-2 text-xs text-stone-600">
                Based on: {o.sources.length > 0 ? o.sources.map((s) => s.title).join(', ') : 'no approved source (general idea only)'}
              </p>
              <button
                className={`${secondaryButtonClass} mt-3`}
                onClick={() => {
                  void navigator.clipboard?.writeText(o.caption);
                  setCopied(i);
                }}
              >
                {copied === i ? 'Copied' : 'Copy text'}
              </button>
            </Card>
          ))}
          {result.options.length > 0 && (
            <Card title="Before using any option">
              <div className="space-y-4">
                <List title="Please confirm" items={result.whatToConfirm} />
                <List title="Risks" items={result.risks} />
                {result.suggestedTiming && (
                  <div>
                    <h3 className="text-sm font-medium">Suggested timing</h3>
                    <p className="text-sm">{result.suggestedTiming}</p>
                  </div>
                )}
                <List title="How to tell if it worked" items={result.howToMeasure} />
                <List title="Photo tips" items={result.photoTips} />
                <p className="text-xs text-stone-500">Submitting a draft for approval is the next step and is coming soon.</p>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
