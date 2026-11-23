import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { INTERVIEW_QUESTIONS, type InterviewSessionSummary } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass } from '../ui';

export function Interviews() {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<InterviewSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [isPractice, setIsPractice] = useState(false);
  const [role, setRole] = useState('');
  const [notesConsent, setNotesConsent] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/interviews');
    if (res.ok) setList(((await res.json()) as { interviews: InterviewSessionSummary[] }).interviews);
    else setError(await readError(res));
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch('/api/interviews', { method: 'POST', body: { label: label || undefined, isPractice, intervieweeName: name, intervieweeRole: role || undefined, notesConsent, aiConsent } });
    setBusy(false);
    if (res.ok) navigate(`/interviews/${((await res.json()) as { sessionId: string }).sessionId}`);
    else setError(await readError(res));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Brand interviews</h1>
        <p className="text-sm text-stone-600">
          Capture management&apos;s view of the brand in their own words, using the same {INTERVIEW_QUESTIONS.length} questions as the printed guide. Nothing becomes a brand rule until an
          administrator approves the exact wording.
        </p>
      </div>

      <Card title="Start an interview">
        <form onSubmit={start} className="space-y-4">
          <label className="block text-sm font-medium">
            Name this interview (optional)
            <input className={inputClass} maxLength={120} placeholder="e.g. First brand interview" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={isPractice} onChange={(e) => setIsPractice(e.target.checked)} />
            This is a practice interview. It is kept, but never used to compare managers&apos; real answers.
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Who are you interviewing?
              <input className={inputClass} required maxLength={120} placeholder="e.g. Elliot" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              Their role (optional)
              <input className={inputClass} maxLength={120} placeholder="e.g. General manager" value={role} onChange={(e) => setRole(e.target.value)} />
            </label>
          </div>
          <fieldset className="space-y-2 rounded-md bg-stone-50 p-3 text-sm">
            <legend className="font-medium">Ask first, and tick only what they agreed to</legend>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={notesConsent} onChange={(e) => setNotesConsent(e.target.checked)} />
              They agreed that we can take detailed notes of their answers. (Required.)
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />
              They agreed that their answers may be sent to the AI service (Anthropic&apos;s Claude) to suggest follow-up questions and draft brand rules. If not, answers are kept in
              the app only and you draft rules by hand. This can be withdrawn later but not added afterwards.
            </label>
          </fieldset>
          {error && <Alert kind="error">{error}</Alert>}
          <button className={buttonClass} disabled={busy || !notesConsent || !name.trim()}>
            {busy ? 'Starting…' : 'Start interview'}
          </button>
        </form>
      </Card>

      <Card title="Interviews">
        {list === null && !error && <p className="text-sm text-stone-500">Loading…</p>}
        {list?.length === 0 && <p className="text-sm text-stone-500">No interviews yet.</p>}
        <ul className="divide-y divide-stone-200">
          {list?.map((s) => (
            <li key={s.id} className="py-3">
              <Link to={`/interviews/${s.id}`} className="font-medium underline">
                {s.label ? `${s.label}: ` : ''}
                {s.intervieweeName}
                {s.intervieweeRole && ` (${s.intervieweeRole})`}
              </Link>
              {s.isPractice && <span className="ml-2 rounded-full bg-stone-100 px-2 text-xs text-stone-600">Practice</span>}
              <p className="text-xs text-stone-500">
                {s.status === 'completed' ? 'Completed' : 'In progress'} · {s.answered} of {INTERVIEW_QUESTIONS.length} questions answered · started {new Date(s.createdAt).toLocaleDateString()} by{' '}
                {s.conductedBy.name} · {s.aiConsent ? 'AI help allowed' : 'no AI use'}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
