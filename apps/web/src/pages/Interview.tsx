import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  INTERVIEW_QUESTIONS,
  INTERVIEW_SECTIONS,
  type InterviewAnswerView,
  type InterviewExtraction,
  type InterviewProposal,
  type InterviewQuestion,
  type InterviewSessionDetail,
} from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, Card, buttonClass, inputClass, secondaryButtonClass } from '../ui';

type Api = ReturnType<typeof useAuth>['apiFetch'];

function AnswerBox({
  sessionId,
  questionId,
  questionText,
  saved,
  locked,
  onSaved,
}: {
  sessionId: string;
  questionId: string;
  questionText?: string;
  saved: string;
  locked: boolean;
  onSaved: () => Promise<void>;
}) {
  const { apiFetch } = useAuth();
  const [text, setText] = useState(saved);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => setText(saved), [saved]);
  const dirty = text !== saved;

  async function save() {
    setState('saving');
    const res = await apiFetch(`/api/interviews/${sessionId}/answers`, { method: 'POST', body: { questionId, questionText, answer: text } });
    setState(res.ok ? 'saved' : 'error');
    if (res.ok) await onSaved();
  }

  return (
    <div>
      <textarea
        className={`${inputClass} min-h-20`}
        disabled={locked}
        maxLength={8000}
        placeholder="Their words, as close to verbatim as you can"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState('idle');
        }}
        onBlur={() => {
          if (dirty && !locked) void save();
        }}
      />
      <p className="mt-1 text-xs text-stone-500" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'error' ? 'Could not save. Try again.' : dirty ? 'Not saved yet (saves when you click away)' : saved ? 'Saved' : ''}
      </p>
    </div>
  );
}

function QuestionCard({ q, detail, reload, api }: { q: InterviewQuestion; detail: InterviewSessionDetail; reload: () => Promise<void>; api: Api }) {
  const locked = detail.status === 'completed';
  const answers = detail.answers.filter((a) => a.questionId === q.id || a.questionId.startsWith(`${q.id}.`));
  const main = answers.find((a) => a.questionId === q.id);
  const followUps = answers.filter((a) => a.questionId !== q.id).sort((a, b) => a.questionId.localeCompare(b.questionId));
  const [pending, setPending] = useState<{ questionId: string; text: string; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function suggest() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/interviews/${detail.id}/follow-up`, { method: 'POST', body: { questionId: q.id } });
    setBusy(false);
    if (res.ok) {
      const b = (await res.json()) as { followUp: string; questionId: string; source: string };
      setPending({ questionId: b.questionId, text: b.followUp, source: b.source });
    } else setError(await readError(res));
  }

  return (
    <div className="space-y-3 border-t border-stone-200 pt-4 first:border-t-0 first:pt-0">
      <p className="font-medium">
        <span className="mr-2 text-xs text-stone-500">{q.id}</span>
        {q.question}
      </p>
      {q.followUp && <p className="text-xs text-stone-500">If the answer is short: {q.followUp}</p>}
      <AnswerBox sessionId={detail.id} questionId={q.id} saved={main?.answer ?? ''} locked={locked} onSaved={reload} />
      {followUps.map((f) => (
        <div key={f.questionId} className="ml-4 border-l-2 border-stone-200 pl-3">
          <p className="text-sm font-medium">
            <span className="mr-2 text-xs text-stone-500">{f.questionId}</span>
            {f.questionText}
          </p>
          <AnswerBox sessionId={detail.id} questionId={f.questionId} questionText={f.questionText} saved={f.answer} locked={locked} onSaved={reload} />
        </div>
      ))}
      {pending && (
        <div className="ml-4 border-l-2 border-amber-300 pl-3">
          <p className="text-sm font-medium">
            <span className="mr-2 text-xs text-stone-500">{pending.questionId}</span>
            {pending.text}
            <span className="ml-2 text-xs font-normal text-stone-500">({pending.source === 'ai' ? 'suggested by the assistant' : 'from the guide'})</span>
          </p>
          <AnswerBox
            sessionId={detail.id}
            questionId={pending.questionId}
            questionText={pending.text}
            saved=""
            locked={locked}
            onSaved={async () => {
              setPending(null);
              await reload();
            }}
          />
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {!locked && main && !pending && (
        <button className={`${secondaryButtonClass} text-xs`} disabled={busy} onClick={() => void suggest()}>
          {busy ? 'Thinking…' : 'Suggest a follow-up question'}
        </button>
      )}
    </div>
  );
}

function ProposalCard({ p, index, extraction, sessionId, canSave, onSaved }: { p: InterviewProposal; index: number; extraction: InterviewExtraction; sessionId: string; canSave: boolean; onSaved: () => Promise<void> }) {
  const { apiFetch } = useAuth();
  const [kind, setKind] = useState(p.kind);
  const [title, setTitle] = useState(p.title);
  const [body, setBody] = useState(p.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/interviews/${sessionId}/proposals`, { method: 'POST', body: { extractionId: extraction.id, index, kind, title, body } });
    setBusy(false);
    if (res.ok) await onSaved();
    else setError(await readError(res));
  }

  return (
    <div className="space-y-2 rounded-md border border-stone-200 p-4">
      {p.savedAs ? (
        <>
          <p className="font-medium">{p.title}</p>
          <p className="text-sm">{p.body}</p>
          <Alert kind="success">
            Saved to the knowledge library as a proposal.{' '}
            <Link to="/knowledge" className="underline">
              An administrator can review it there.
            </Link>
          </Alert>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-md border border-stone-300 px-2 py-1 text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={!canSave}>
              <option value="brand_rule">Brand rule</option>
              <option value="fact">Fact (needs a verifier)</option>
            </select>
            <input className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1 text-sm font-medium" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={!canSave} />
          </div>
          <textarea className={`${inputClass} min-h-16 text-sm`} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} disabled={!canSave} />
        </>
      )}
      <div className="text-xs text-stone-600">
        <p className="font-medium">In their words:</p>
        <ul className="list-disc pl-5">
          {p.support.map((s, i) => (
            <li key={i}>
              {s.questionId}: “{s.quote}”
            </li>
          ))}
        </ul>
      </div>
      {p.verifyWith && <p className="text-xs text-stone-600">Verify with: {p.verifyWith}</p>}
      {p.conflicts.length > 0 && (
        <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-medium">Disagreement to raise with management (not resolved here):</p>
          <ul className="list-disc pl-5">
            {p.conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {!p.savedAs && canSave && (
        <button className={secondaryButtonClass} disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save as a proposal'}
        </button>
      )}
    </div>
  );
}

export function Interview() {
  const { sessionId } = useParams();
  const { me, apiFetch } = useAuth();
  const [detail, setDetail] = useState<InterviewSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/interviews/${sessionId}`);
    if (res.ok) setDetail((await res.json()) as InterviewSessionDetail);
    else setError(await readError(res));
  }, [apiFetch, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return null;
  if (!detail) return error ? <Alert kind="error">{error}</Alert> : <p className="text-sm text-stone-500">Loading…</p>;

  async function act(name: string, path: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    setError(null);
    const res = await apiFetch(path, { method: 'POST', body: {} });
    setBusy(null);
    if (res.ok) await load();
    else setError(await readError(res));
  }

  const answeredIds = new Set(detail.answers.map((a: InterviewAnswerView) => a.questionId));
  const answered = INTERVIEW_QUESTIONS.filter((q) => answeredIds.has(q.id)).length;
  const latest = detail.extractions[0];
  const canSave = me.capabilities.includes('knowledge.propose');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/interviews" className="text-sm text-stone-600 hover:underline">
          ← All interviews
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          Interview with {detail.intervieweeName}
          {detail.intervieweeRole && <span className="text-stone-500"> ({detail.intervieweeRole})</span>}
        </h1>
        <p className="text-sm text-stone-600">
          {detail.status === 'completed' ? 'Completed' : 'In progress'} · {answered} of {INTERVIEW_QUESTIONS.length} questions answered ·{' '}
          {detail.aiConsent ? 'they agreed to AI help' : 'no AI use (they did not agree, or withdrew)'}
        </p>
        <p className="mt-1 text-xs text-stone-500">Don&apos;t lead: ask the question first, and use the follow-ups only if the answer is short. Sections A to E matter most.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {INTERVIEW_SECTIONS.map((s) => (
        <Card key={s.id} title={`${s.id}. ${s.title}`}>
          <p className="-mt-2 mb-4 text-xs text-stone-500">Usually becomes: {s.becomes}</p>
          <div className="space-y-6">
            {s.questions.map((q) => (
              <QuestionCard key={q.id} q={q} detail={detail} reload={load} api={apiFetch} />
            ))}
          </div>
        </Card>
      ))}

      <Card title="After the interview">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {detail.aiConsent && (
              <button className={buttonClass} disabled={busy !== null || detail.answers.length === 0} onClick={() => void act('extract', `/api/interviews/${detail.id}/extract`)}>
                {busy === 'extract' ? 'Drafting… (up to a minute)' : latest ? 'Draft brand rules again' : 'Draft brand rules from these answers'}
              </button>
            )}
            {detail.status !== 'completed' && (
              <button
                className={secondaryButtonClass}
                disabled={busy !== null}
                onClick={() => void act('complete', `/api/interviews/${detail.id}/complete`, 'Mark this interview as completed? Answers can no longer be changed afterwards.')}
              >
                Mark interview completed
              </button>
            )}
            {detail.aiConsent && (
              <button
                className={secondaryButtonClass}
                disabled={busy !== null}
                onClick={() => void act('withdraw', `/api/interviews/${detail.id}/withdraw-ai-consent`, 'Stop all AI use for this interview? This cannot be undone.')}
              >
                They withdrew AI consent
              </button>
            )}
          </div>
          {!detail.aiConsent && <Alert kind="info">Without AI consent, write proposed brand rules by hand in Knowledge, quoting the answers above.</Alert>}

          {latest && (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">
                Suggestions from {new Date(latest.createdAt).toLocaleString()}. Every quote was checked word for word against the answers above. Edit the wording if you like, then save the
                ones worth keeping. They go to Knowledge as <strong>proposals</strong>; only an administrator can approve them.
              </p>
              {latest.provider === 'mock' && <Alert kind="info">Practice mode: these suggestions are placeholders because no AI service is connected.</Alert>}
              {latest.warnings.map((w, i) => (
                <Alert key={i} kind="info">
                  {w}
                </Alert>
              ))}
              {latest.proposals.length === 0 && <p className="text-sm text-stone-500">No suggestions this time.</p>}
              {latest.proposals.map((p, i) => (
                <ProposalCard key={`${latest.id}-${i}`} p={p} index={i} extraction={latest} sessionId={detail.id} canSave={canSave} onSaved={load} />
              ))}
              {latest.openQuestions.length > 0 && (
                <div>
                  <p className="text-sm font-medium">Still for management to decide</p>
                  <ul className="list-disc pl-5 text-sm">
                    {latest.openQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
