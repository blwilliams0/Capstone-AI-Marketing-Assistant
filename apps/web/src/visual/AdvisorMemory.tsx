import { useEffect, useState } from 'react';
import { defaultAdvisorPreference, type AdvisorPreference } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, buttonClass, inputClass, secondaryButtonClass } from '../ui';

export function AdvisorPreferences() {
  const { apiFetch } = useAuth();
  const [preference, setPreference] = useState<AdvisorPreference>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void apiFetch('/api/assistant/preferences').then(async (response) => {
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json() as { preference: AdvisorPreference };
      if (active) setPreference(body.preference);
    }).catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [apiFetch]);

  async function save(value: AdvisorPreference) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await apiFetch('/api/assistant/preferences', { method: 'POST', body: value });
      if (!response.ok) throw new Error(await readError(response));
      setPreference((await response.json()).preference);
      setMessage(value.enabled ? 'Preferences saved.' : 'Personalization is off.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save preferences.');
    } finally { setBusy(false); }
  }

  return <details className="rounded-lg border border-studio-linen bg-studio-pearl p-3">
    <summary className="cursor-pointer font-semibold">Personal working preferences</summary>
    <p className="mt-2 text-sm text-studio-muted">These settings affect your Advisor replies. Restaurant standards remain under management approval.</p>
    {error && <Alert kind="error">{error}</Alert>}
    {message && <Alert kind="success">{message}</Alert>}
    {preference && <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(preference); }}>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={preference.enabled}
        onChange={(event) => setPreference({ ...preference, enabled: event.target.checked })} /> Use my preferences in replies</label>
      <label className="block text-sm">Response detail<select className={inputClass} value={preference.detail}
        onChange={(event) => setPreference({ ...preference, detail: event.target.value as AdvisorPreference['detail'] })}>
        <option value="standard">Standard</option><option value="brief">Brief</option><option value="detailed">Detailed</option>
      </select></label>
      <label className="block text-sm">Usual workflow<select className={inputClass} value={preference.workflow}
        onChange={(event) => setPreference({ ...preference, workflow: event.target.value as AdvisorPreference['workflow'] })}>
        <option value="none">No preference</option><option value="brainstorm">Brainstorming</option><option value="writing">Writing</option><option value="photography">Photography</option>
      </select></label>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy}>Save preferences</button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void save(defaultAdvisorPreference)}>Clear preferences</button>
      </div>
    </form>}
  </details>;
}

export function AdvisorFeedback({ conversationId, reviewId }: { conversationId?: string; reviewId?: string }) {
  const { apiFetch, me } = useAuth();
  const [feedbackId, setFeedbackId] = useState<string>();
  const [rating, setRating] = useState('helpful');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await apiFetch('/api/assistant/feedback', { method: 'POST', body: { conversationId, reviewId, rating, note } });
      if (!response.ok) throw new Error(await readError(response));
      setFeedbackId(((await response.json()) as { id: string }).id);
      setNote('');
      setMessage('Private feedback recorded.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save feedback.');
    } finally { setBusy(false); }
  }
  return <details className="rounded-md border border-studio-linen p-2 text-sm">
    <summary className="cursor-pointer font-semibold">Give feedback</summary>
    <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block">Rating<select className={inputClass} value={rating} onChange={(event) => setRating(event.target.value)}>
        <option value="helpful">Helpful</option><option value="unhelpful">Unhelpful</option><option value="on_brand">On-brand</option>
        <option value="off_brand">Off-brand</option><option value="correction">Correction</option>
      </select></label>
      <label className="block">Optional note<textarea className={inputClass} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></label>
      <button className={buttonClass} disabled={busy}>Record feedback</button>
      {message && <Alert kind="success">{message}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
    </form>
    {feedbackId && me?.capabilities.includes('knowledge.propose') && <ShareLearning key={feedbackId} feedbackId={feedbackId} />}
  </details>;
}


function ShareLearning({ feedbackId }: { feedbackId: string }) {
  const { apiFetch } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function share() {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/assistant/feedback/${feedbackId}/propose`, {
        method: 'POST', body: { title, body, evidence, shareConfirmed: confirmed },
      });
      if (!response.ok) throw new Error(await readError(response));
      setSaved(true);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  if (saved) return <Alert kind="success">Learning proposed in Brand Studio for management review.</Alert>;
  return <details className="mt-2 border-t border-studio-linen pt-2">
    <summary className="cursor-pointer font-semibold">Propose a restaurant learning</summary>
    <p className="my-2 text-studio-muted">Write guidance that the team can use. Brand Studio receives only the text below. Keep guest and private account details out.</p>
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void share(); }}>
      <label className="block">Title<input className={inputClass} required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block">Suggested guidance<textarea className={inputClass} required maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <label className="block">Evidence to share (optional)<textarea className={inputClass} maxLength={400} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Share this proposal with Brand Studio</label>
      <button className={buttonClass} disabled={busy || !confirmed || !title.trim() || !body.trim()}>Share for review</button>
      {error && <Alert kind="error">{error}</Alert>}
    </form>
  </details>;
}
