import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  INTERVIEW_QUESTIONS,
  INTERVIEW_SECTIONS,
  type InterviewAnswerView,
  type InterviewExtraction,
  type InterviewProposal,
  type InterviewQuestion,
  type InterviewSessionDetail,
  type TranscriptFillResult,
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
  // Take the server's text only if the box still shows the previous saved text: never overwrite
  // words typed while a save was on its way.
  const lastSaved = useRef(saved);
  useEffect(() => {
    setText((t) => (t === lastSaved.current ? saved : t));
    lastSaved.current = saved;
  }, [saved]);
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
      {main?.source === 'transcript' && (
        <p className="text-xs text-amber-800">Filled from the transcript (their exact words). Check it is the manager speaking, then edit if needed.</p>
      )}
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
          <p className="font-medium">{p.savedAs.title}</p>
          <p className="text-sm">{p.savedAs.body}</p>
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
          <p className="font-medium">Possible disagreement to raise with management (the assistant’s summary, not checked word for word; not resolved here):</p>
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

/** Rename the interview or mark it as practice. */
function DetailsEditor({ detail, onSaved }: { detail: InterviewSessionDetail; onSaved: () => Promise<void> }) {
  const { apiFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(detail.label ?? '');
  const [isPractice, setIsPractice] = useState(detail.isPractice);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="text-sm underline" onClick={() => setOpen(true)}>
        Rename this interview or mark it as practice
      </button>
    );
  }
  return (
    <Card title="Interview name">
      <div className="space-y-3">
        <input className={inputClass} maxLength={120} placeholder="e.g. First brand interview" value={label} onChange={(e) => setLabel(e.target.value)} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={isPractice} onChange={(e) => setIsPractice(e.target.checked)} />
          Practice interview (kept, but never used to compare managers&apos; real answers)
        </label>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex gap-2">
          <button
            className={buttonClass}
            onClick={async () => {
              const res = await apiFetch(`/api/interviews/${detail.id}/details`, { method: 'POST', body: { label: label.trim() || null, isPractice } });
              if (!res.ok) return setError(await readError(res));
              setOpen(false);
              await onSaved();
            }}
          >
            Save
          </button>
          <button className={secondaryButtonClass} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </Card>
  );
}

/** Removes caption-file timing lines (WEBVTT, cue numbers, "00:01 --> 00:04") so only speech is left. */
function cleanTranscript(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^WEBVTT/.test(line) && !/^\d+$/.test(line.trim()) && !/-->/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Upload or paste a transcript; the AI places the manager's own words under the guide's questions. */
function TranscriptCard({ detail, onFilled }: { detail: InterviewSessionDetail; onFilled: () => Promise<void> }) {
  const { apiFetch } = useAuth();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [replaceTyped, setReplaceTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptFillResult | null>(null);
  if (detail.status === 'completed') return null;

  async function pickFile(file: File) {
    setError(null);
    if (/\.docx?$/i.test(file.name)) return setError('Word files are not supported yet. In Word, choose File → Save As → Plain Text (.txt), or copy and paste the text below.');
    if (file.size > 2_000_000) return setError('That file is too large for a transcript.');
    setText(cleanTranscript(await file.text()));
    setFileName(file.name);
  }

  async function fill() {
    setBusy(true);
    setError(null);
    setResult(null);
    const up = await apiFetch(`/api/interviews/${detail.id}/transcripts`, { method: 'POST', body: { fileName, text } });
    if (!up.ok) {
      setBusy(false);
      return setError(await readError(up));
    }
    const { transcriptId } = (await up.json()) as { transcriptId: string };
    const res = await apiFetch(`/api/interviews/${detail.id}/transcripts/fill`, { method: 'POST', body: { transcriptId, replaceTyped } });
    setBusy(false);
    if (!res.ok) return setError(await readError(res));
    setResult((await res.json()) as TranscriptFillResult);
    setText('');
    setFileName(undefined);
    await onFilled();
  }

  return (
    <Card title="Have a transcript of the interview?">
      <div className="space-y-3">
        {!detail.aiConsent ? (
          <Alert kind="info">The interviewee did not agree to AI use, so a transcript cannot be read by the AI. Type the answers in below instead.</Alert>
        ) : (
          <>
            <p className="text-sm text-stone-600">
              Upload or paste a transcript (for example from Zoom, Teams, Otter or a phone recording app). The assistant puts the manager&apos;s own words under each question. It can
              only copy words that are really in the transcript; it never writes answers. Check each answer afterwards.
            </p>
            <input type="file" accept=".txt,.md,.vtt,.srt,text/plain" onChange={(e) => e.target.files?.[0] && void pickFile(e.target.files[0])} className="text-sm" />
            <textarea
              className={`${inputClass} min-h-32 text-sm`}
              placeholder="…or paste the transcript here"
              value={text}
              maxLength={150000}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(undefined);
              }}
            />
            <p className="text-xs text-stone-500">{text.length.toLocaleString()} of 150,000 characters · about 30–60 cents to process a one-hour interview</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={replaceTyped} onChange={(e) => setReplaceTyped(e.target.checked)} />
              Also replace answers someone already typed (otherwise typed answers are kept)
            </label>
            {error && <Alert kind="error">{error}</Alert>}
            <button className={buttonClass} disabled={busy || text.trim().length < 20} onClick={() => void fill()}>
              {busy ? 'Reading the transcript… (up to a few minutes)' : 'Fill in the answers from this transcript'}
            </button>
          </>
        )}
        {result && (
          <Alert kind="success">
            Filled {result.filled.length} question{result.filled.length === 1 ? '' : 's'} from the transcript
            {result.keptTyped.length > 0 && `; kept ${result.keptTyped.length} typed answer${result.keptTyped.length === 1 ? '' : 's'}`}
            {result.notCovered.length > 0 && `. Not covered: ${result.notCovered.join(', ')}`}.
          </Alert>
        )}
        {result?.warnings.map((w, i) => (
          <Alert key={i} kind="info">
            {w}
          </Alert>
        ))}
        {detail.transcripts.length > 0 && (
          <p className="text-xs text-stone-500">
            Transcripts on file:{' '}
            {detail.transcripts.map((t) => `${t.fileName ?? 'pasted text'} (${t.characters.toLocaleString()} characters, ${new Date(t.uploadedAt).toLocaleDateString()})`).join('; ')}
          </p>
        )}
      </div>
    </Card>
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
          {detail.label ? `${detail.label}: ` : 'Interview with '}
          {detail.intervieweeName}
          {detail.isPractice && <span className="ml-2 rounded-full bg-stone-100 px-2 align-middle text-xs font-normal text-stone-600">Practice</span>}
          {detail.intervieweeRole && <span className="text-stone-500"> ({detail.intervieweeRole})</span>}
        </h1>
        <p className="text-sm text-stone-600">
          {detail.status === 'completed' ? 'Completed' : 'In progress'} · {answered} of {INTERVIEW_QUESTIONS.length} questions answered ·{' '}
          {detail.aiConsent ? 'they agreed to AI help' : 'no AI use (they did not agree, or withdrew)'}
        </p>
        <p className="mt-1 text-xs text-stone-500">Don&apos;t lead: ask the question first, and use the follow-ups only if the answer is short. Sections A to E matter most.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <DetailsEditor detail={detail} onSaved={load} />
      <TranscriptCard detail={detail} onFilled={load} />

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
                onClick={() => void act('withdraw', `/api/interviews/${detail.id}/withdraw-ai-consent`, 'Stop AI use for this interview from now on? No more follow-up suggestions or drafted rules, and suggestions already drafted can no longer be saved. Rules already saved stay in Knowledge for an administrator to decide. This cannot be undone.')}
              >
                They withdrew AI consent
              </button>
            )}
          </div>
          {!detail.aiConsent && <Alert kind="info">Without AI consent, write proposed brand rules by hand in Knowledge, quoting the answers above.</Alert>}

          {latest && (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">
                Suggestions from {new Date(latest.createdAt).toLocaleString()}. Every quote was checked word for word against the answers, and is checked again when you save. Edit the wording if you like, then save the
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
