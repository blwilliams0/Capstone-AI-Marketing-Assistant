import { Composer } from '../advisor/Composer';
import { AdvisorFeedback, AdvisorPreferences } from '../visual/AdvisorMemory';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KNOWLEDGE_KIND_LABELS, type AskResponse, type AssistantStatus, type KnowledgeKind, type SourceRef } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { Alert, secondaryButtonClass } from '../ui';
import { VisualWorkspace } from './VisualStudio';

interface Turn {
  question: string;
  answer: string;
  sources: SourceRef[];
  consulted?: AskResponse['consulted'];
}

interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
}

const EXAMPLES = [
  'What should we promote this week for locals?',
  'How should we describe the patio to visitors?',
  'Give me three Instagram ideas for a wine dinner.',
  'How can we get more referrals from the Inn and hotels?',
];

const kindName = (k: string) => KNOWLEDGE_KIND_LABELS[k as KnowledgeKind]?.name ?? k;

export function Assistant() {
  const location = useLocation();
  const navigate = useNavigate();
  const handoff = location.state as { question?: string; assetId?: string } | null;
  const { apiFetch, me } = useAuth();
  const canDraft = me?.capabilities.includes('content.draft') ?? false;
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState('');
  const [photoTask, setPhotoTask] = useState<{ assetId: string; question: string; key: string }>();
  const request = useRef<AbortController | null>(null);
  const consumed = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);

  const loadHistory = useCallback(async () => {
    const res = await apiFetch('/api/assistant/conversations');
    if (!res.ok) throw new Error(await readError(res));
    setHistory(((await res.json()) as { conversations: ConversationSummary[] }).conversations);
  }, [apiFetch]);

  useEffect(() => {
    void apiFetch('/api/assistant/status')
      .then(async (res) => {
        if (!res.ok) throw new Error('Assistant status unavailable');
        setStatus((await res.json()) as AssistantStatus);
      })
      .catch(() => setError('Could not check whether the advisor is available.'));
    void loadHistory().catch(() => setError('Could not load conversation history.'));
  }, [apiFetch, loadHistory]);

  async function openConversation(id: string) {
    if (busy || opening) return;
    setOpening(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/assistant/conversations/${id}`);
      if (!res.ok) return setError(await readError(res));
      const { messages } = (await res.json()) as { messages: { role: string; content: string; sources: SourceRef[] }[] };
      const restored: Turn[] = [];
      for (let i = 0; i + 1 < messages.length; i += 2) {
        restored.push({ question: messages[i]!.content, answer: messages[i + 1]!.content, sources: messages[i + 1]!.sources ?? [] });
      }
      setTurns(restored);
      setConversationId(id);
    } catch {
      setError('Could not open that conversation. Try again.');
    } finally {
      setOpening(false);
    }
  }

  const submit = useCallback(async (text: string, id?: string) => {
    if (request.current || text.trim().length < 3) return;
    const controller = new AbortController();
    request.current = controller;
    setQuestion(text);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/assistant/ask', {
        method: 'POST', body: { question: text, conversationId: id }, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) return setError(await readError(res));
      const out = (await res.json()) as AskResponse;
      if (controller.signal.aborted) return;
      setTurns((previous) => [...previous, { question: text, answer: out.answer, sources: out.sources, consulted: out.consulted }]);
      setConversationId(out.conversationId);
      setQuestion((current) => current === text ? '' : current);
      if (!id) void loadHistory().catch(() => setError('The reply was saved, but the history could not refresh.'));
    } catch {
      if (!controller.signal.aborted) setError('Could not send the question. Try again.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }, [apiFetch, loadHistory]);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (!handoff?.question || consumed.current === location.key) return;
    if (!handoff.assetId && !status) return;
    consumed.current = location.key;
    if (handoff.assetId && __MOCK_AUTH__ && canDraft) {
      setPhotoTask({ assetId: handoff.assetId, question: handoff.question, key: location.key });
    } else if (status?.available) {
      void submit(handoff.question);
    } else {
      setQuestion(handoff.question);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [handoff, status, location.key, location.pathname, navigate, submit, canDraft]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">AI Advisor</h1>
          <p className="text-sm text-stone-600">
            Answers use The Pocket's approved brand rules, facts and strategy. Always check anything marked "Please confirm" before acting.
          </p>
        </div>
        {status?.provider === 'mock' && (
          <Alert kind="info">Practice mode: no AI service is connected, so answers are placeholders. Nothing is sent anywhere.</Alert>
        )}
        {status && !status.available && <Alert kind="error">The assistant is not set up yet. An administrator needs to add the AI service key.</Alert>}

        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <button key={q} className={secondaryButtonClass} onClick={() => setQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-3">
            <p className="ml-auto max-w-prose break-words rounded-lg bg-stone-900 px-4 py-2 text-white">{t.question}</p>
            <div className="max-w-prose rounded-lg bg-white p-4 shadow-sm ring-1 ring-stone-200">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{t.answer}</p>
              {t.sources.length > 0 ? (
                <details className="mt-3 text-sm" open>
                  <summary className="cursor-pointer font-medium">Sources ({t.sources.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {t.sources.map((s) => (
                      <li key={s.versionId} className="rounded border border-stone-200 p-2">
                        <span className="font-medium">{s.title}</span> <span className="text-xs text-stone-500">· {kindName(s.kind)}</span>
                        {s.quotes.map((q, j) => (
                          <blockquote key={j} className="mt-1 border-l-2 border-stone-300 pl-2 text-xs text-stone-600">
                            {q}
                          </blockquote>
                        ))}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="mt-3 text-xs text-stone-500">No approved source was cited. Treat this as general advice.</p>
              )}
              {canDraft && (
                <Link to="/create" state={{ topic: t.question.slice(0, 1000) }} className="mt-3 inline-block text-sm underline underline-offset-4">
                  Draft content from this question
                </Link>
              )}
              {t.consulted && t.consulted.length > 0 && (
                <details className="mt-2 text-xs text-stone-500">
                  <summary className="cursor-pointer">What the assistant was given ({t.consulted.length})</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {canDraft && (
                <Link to="/create" state={{ topic: t.question.slice(0, 1000) }} className="mt-3 inline-block text-sm underline underline-offset-4">
                  Draft content from this question
                </Link>
              )}
              {t.consulted.map((c, j) => (
                      <li key={j}>
                        {c.title} ({kindName(c.kind)}
                        {c.core ? ', brand core' : ''})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        ))}

        {error && <Alert kind="error">{error}</Alert>}
        <Composer value={question} onChange={setQuestion} pending={busy} autoFocus
          attachmentTools={__MOCK_AUTH__ && canDraft} disabled={opening || !status?.available}
          onSend={(text, photo) => {
            if (photo) {
              setPhotoTask({ assetId: photo.id, question: text, key: crypto.randomUUID() });
              setQuestion('');
            } else void submit(text, conversationId);
          }}>
          {busy && <button type="button" className="text-sm underline" onClick={() => request.current?.abort()}>Cancel response display</button>}
        </Composer>
        {(conversationId || question || photoTask) && <button type="button" className={secondaryButtonClass} disabled={busy || opening} onClick={() => {
          setError(null);
          setQuestion('');
          setTurns([]);
          setConversationId(undefined);
          setPhotoTask(undefined);
        }}>New conversation</button>}
      </div>

      {__MOCK_AUTH__ && canDraft && <details key={photoTask?.key} open={photoTask ? true : undefined} className="order-last rounded-lg border border-studio-linen bg-studio-pearl p-4 xl:col-span-2">
        <summary className="cursor-pointer font-semibold">Photos in AI Advisor</summary>
        <div className="mt-4"><VisualWorkspace advisor initialAssetId={photoTask?.assetId} initialPrompt={photoTask?.question} /></div>
      </details>}
      <aside className="self-start space-y-2 rounded-xl border border-stone-200 bg-white p-4">
        <AdvisorPreferences />
        {conversationId && <AdvisorFeedback key={conversationId} conversationId={conversationId} />}
        <h2 className="text-sm font-medium text-stone-600">Your recent conversations</h2>
        {history.length === 0 && <p className="text-sm text-stone-500">None yet.</p>}
        <ul className="space-y-1">
          {history.map((c) => (
            <li key={c.id}>
              <button
                className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-stone-100 ${c.id === conversationId ? 'bg-stone-200' : ''}`}
                aria-current={c.id === conversationId ? 'true' : undefined}
                disabled={busy || opening}
                onClick={() => void openConversation(c.id)}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
