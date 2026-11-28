import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KNOWLEDGE_KIND_LABELS, type AskResponse, type AssistantStatus, type KnowledgeKind, type SourceRef } from '@the-pocket/shared';
import { readError, useAuth } from '../auth';
import { RichText } from '../components/RichText';
import { Alert, buttonClass, inputClass, secondaryButtonClass } from '../ui';

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
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);

  const loadHistory = useCallback(async () => {
    const res = await apiFetch('/api/assistant/conversations');
    if (res.ok) setHistory(((await res.json()) as { conversations: ConversationSummary[] }).conversations);
  }, [apiFetch]);

  useEffect(() => {
    void apiFetch('/api/assistant/status').then(async (r) => r.ok && setStatus((await r.json()) as AssistantStatus));
    void loadHistory();
  }, [apiFetch, loadHistory]);

  async function openConversation(id: string) {
    const res = await apiFetch(`/api/assistant/conversations/${id}`);
    if (!res.ok) return setError(await readError(res));
    const { messages } = (await res.json()) as { messages: { role: string; content: string; sources: SourceRef[] }[] };
    const t: Turn[] = [];
    for (let i = 0; i + 1 < messages.length; i += 2) {
      t.push({ question: messages[i]!.content, answer: messages[i + 1]!.content, sources: messages[i + 1]!.sources ?? [] });
    }
    setTurns(t);
    setConversationId(id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (question.trim().length < 3) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch('/api/assistant/ask', { method: 'POST', body: { question, conversationId } });
    if (res.ok) {
      const out = (await res.json()) as AskResponse;
      setTurns((t) => [...t, { question, answer: out.answer, sources: out.sources, consulted: out.consulted }]);
      if (!conversationId) void loadHistory();
      setConversationId(out.conversationId);
      setQuestion('');
    } else setError(await readError(res));
    setBusy(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Ask the marketing assistant</h1>
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
            <p className="ml-auto max-w-prose rounded-lg bg-stone-900 px-4 py-2 text-white">{t.question}</p>
            <div className="max-w-prose rounded-lg bg-white p-4 shadow-sm ring-1 ring-stone-200">
              <p className="whitespace-pre-wrap text-sm"><RichText text={t.answer} /></p>
              {t.sources.length > 0 ? (
                <details className="mt-3 text-sm" open>
                  <summary className="cursor-pointer font-medium">Sources ({t.sources.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {t.sources.map((s) => (
                      <li key={s.versionId} className="rounded border border-stone-200 p-2">
                        <span className="font-medium">{s.title}</span> <span className="text-xs text-stone-500">· {kindName(s.kind)}</span>
                        {s.quotes.map((q, j) => (
                          <blockquote key={j} className="mt-1 border-l-2 border-stone-300 pl-2 text-xs text-stone-600">
                            <RichText text={q} />
                          </blockquote>
                        ))}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="mt-3 text-xs text-stone-500">No approved source was cited. Treat this as general advice.</p>
              )}
              {t.consulted && t.consulted.length > 0 && (
                <details className="mt-2 text-xs text-stone-500">
                  <summary className="cursor-pointer">What the assistant was given ({t.consulted.length})</summary>
                  <ul className="mt-1 list-disc pl-5">
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

        <form onSubmit={submit} className="space-y-2">
          <textarea
            className={`${inputClass} min-h-24`}
            placeholder="Ask a marketing question…"
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
          />
          {error && <Alert kind="error">{error}</Alert>}
          <div className="flex gap-2">
            <button className={buttonClass} disabled={busy || question.trim().length < 3 || status?.available === false}>
              {busy ? 'Thinking…' : 'Ask'}
            </button>
            {turns.length > 0 && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => {
                  setTurns([]);
                  setConversationId(undefined);
                }}
              >
                New conversation
              </button>
            )}
          </div>
        </form>
      </div>

      <aside className="space-y-2">
        <h2 className="text-sm font-medium text-stone-600">Your recent conversations</h2>
        {history.length === 0 && <p className="text-sm text-stone-500">None yet.</p>}
        <ul className="space-y-1">
          {history.map((c) => (
            <li key={c.id}>
              <button
                className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-stone-100 ${c.id === conversationId ? 'bg-stone-200' : ''}`}
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
