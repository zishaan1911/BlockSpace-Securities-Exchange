import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sendChatMessage, type ChatMessage } from '../lib/api';

/**
 * Platform-explainer chatbot, as a persistent floating widget rather
 * than a separate page or nav tab -- it needs to be reachable from
 * wherever someone is looking at the platform, including the landing
 * page before they have "launched" into the app at all.
 *
 * The Groq API key never touches this file. Every message goes through
 * the gateway's POST /api/v1/chat, which holds the key server-side and
 * grounds the assistant in the platform's real, current EGSI/forecast
 * readings -- see api/src/routes/chat.ts's module comment for why that
 * matters (a model with no real data either refuses to answer "what's
 * the EGSI right now" or invents a plausible-sounding number).
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError('');

    try {
      const reply = await sendChatMessage(next);
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant could not respond.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`chat-widget ${open ? 'chat-widget-open' : ''}`}>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="GASX platform assistant">
          <div className="chat-panel-head">
            <div>
              <strong>GASX Assistant</strong>
              <span>Ask about the platform or live EGSI stats</span>
            </div>
            <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </div>

          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Hi! I can explain how GASX works, or tell you the current EGSI and forecast.</p>
                <p>Try: &ldquo;What is EGSI?&rdquo; or &ldquo;What&rsquo;s the current gas stress level?&rdquo;</p>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index} className={`chat-bubble chat-bubble-${message.role}`}>
                {message.content}
              </div>
            ))}

            {busy && <div className="chat-bubble chat-bubble-assistant chat-typing">Thinking…</div>}
          </div>

          {error && <div className="chat-error">{error}</div>}

          <form className="chat-input-row" onSubmit={(event) => void submit(event)}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a question…"
              disabled={busy}
              maxLength={2000}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </div>
      )}

      <button
        className="chat-tab"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close GASX assistant' : 'Open GASX assistant'}
        title="Ask the GASX assistant"
      >
        {open ? '×' : '✦'}
        {!open && <span className="chat-tab-label">Ask GASX</span>}
      </button>
    </div>
  );
}
