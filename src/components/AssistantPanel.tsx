import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Note, PanelTab } from "../types";
import type { AssistantStatus } from "../types";
import { isNaturalVoice, voiceLabel, type useSpeech } from "../hooks/useSpeech";
import { useVoiceInput } from "../hooks/useVoiceInput";
import type { useAssistantChat } from "../hooks/useAssistantChat";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

type Chat = ReturnType<typeof useAssistantChat>;
type Speech = ReturnType<typeof useSpeech>;

interface AssistantPanelProps {
  note: Note | null;
  chat: Chat;
  speech: Speech;
  status: AssistantStatus | null;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
  onConfigure: () => void;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "assistant", label: "Assistant" },
  { id: "history", label: "History" },
];

export function AssistantPanel({ note, chat, speech, status, tab, onTabChange, onClose, onConfigure }: AssistantPanelProps) {
  const questions = chat.messages.filter((message) => message.role === "user");

  // Arrow keys move between the two tabs, as in any tab list.
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((entry) => entry.id === tab) + 1) % TABS.length]!.id;
    onTabChange(next);
    document.getElementById(`panel-tab-${next}`)?.focus();
  };

  return (
    <aside className="side-panel" id="side-panel" aria-label="Assistant and history">
      <header className="side-panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Side panel" onKeyDown={onTabKeyDown}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`panel-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`panel-${entry.id}`}
              tabIndex={tab === entry.id ? 0 : -1}
              className={`panel-tab ${tab === entry.id ? "panel-tab-active" : ""}`}
              onClick={() => onTabChange(entry.id)}
            >
              {entry.label}
              {entry.id === "history" && questions.length > 0 && (
                <span className="panel-tab-count">{questions.length}</span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="Close panel" title="Close panel" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      <div
        role="tabpanel"
        id="panel-assistant"
        aria-labelledby="panel-tab-assistant"
        className="panel-body"
        hidden={tab !== "assistant"}
      >
        <AssistantTab note={note} chat={chat} speech={speech} status={status} onConfigure={onConfigure} />
      </div>
      <div
        role="tabpanel"
        id="panel-history"
        aria-labelledby="panel-tab-history"
        className="panel-body"
        hidden={tab !== "history"}
      >
        {questions.length === 0 ? (
          <EmptyState title="No history yet">
            What you ask the assistant is listed here for this session only. It's never saved.
          </EmptyState>
        ) : (
          <>
            <ol className="history-list">
              {questions.map((question) => (
                <li key={question.id} className="history-item">
                  {question.content}
                </li>
              ))}
            </ol>
            <div className="panel-footer">
              <p className="panel-note">Kept for this session only.</p>
              <button type="button" className="ghost-btn" onClick={chat.clearChat}>
                Clear history
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

interface AssistantTabProps {
  note: Note | null;
  chat: Chat;
  speech: Speech;
  status: AssistantStatus | null;
  onConfigure: () => void;
}

function AssistantTab({ note, chat, speech, status, onConfigure }: AssistantTabProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setDraft("");
    const reply = await chat.sendMessage(text);
    if (reply) speech.speak(reply);
  };

  const voice = useVoiceInput((transcript) => {
    void submit(transcript);
  });

  // The box grows with what you type, up to a few lines.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);

  if (status === null) {
    return <p className="panel-note panel-loading">Checking the assistant…</p>;
  }

  if (!status.configured) {
    return (
      <EmptyState
        title="Connect your AI assistant"
        action={
          <button type="button" className="pill-btn primary" onClick={onConfigure}>
            Configure assistant
          </button>
        }
      >
        Add an API key to ask questions about this document.
      </EmptyState>
    );
  }

  // Only the latest exchange is shown; earlier replies are never listed.
  const lastQuestionIndex = chat.messages.map((message) => message.role).lastIndexOf("user");
  const question = chat.messages[lastQuestionIndex];
  const following = chat.messages[lastQuestionIndex + 1];
  const reply = following?.role === "assistant" ? following : null;
  const naturalVoices = speech.voices.filter(isNaturalVoice);
  const plainVoices = speech.voices.filter((entry) => !isNaturalVoice(entry));

  return (
    <div className="assistant-tab">
      <p className="panel-context">
        {note ? (
          <>
            Asking about <strong>{note.title || "Untitled"}</strong>
          </>
        ) : (
          "No note open: questions go without a note."
        )}
      </p>

      <div className="exchange" aria-live="polite">
        {!question ? (
          <EmptyState title="Ask about this note">
            Type or speak a question below. The answer appears here and is read aloud; only the latest one is kept.
          </EmptyState>
        ) : (
          <>
            <div className="exchange-question">{question.content}</div>
            {chat.isThinking && <p className="exchange-status">Thinking…</p>}
            {reply && (
              <div className="exchange-reply">
                <p>{reply.content}</p>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => (speech.status === "idle" ? speech.speak(reply.content) : speech.stop())}
                >
                  <Icon name={speech.status === "idle" ? "sound" : "stop"} size={16} />
                  {speech.status === "idle" ? "Read aloud" : "Stop"}
                </button>
              </div>
            )}
            {chat.error && <p className="exchange-error">{chat.error}</p>}
          </>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <label className="visually-hidden" htmlFor="assistant-input">
          Ask the assistant
        </label>
        <textarea
          ref={inputRef}
          id="assistant-input"
          className="composer-input"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit(draft);
            }
          }}
          placeholder={
            voice.state === "listening"
              ? "Listening… pause when you're done"
              : voice.state === "transcribing"
                ? "Writing down what you said…"
                : "Ask a question"
          }
          disabled={chat.isThinking || voice.state === "transcribing"}
        />
        <div className="composer-actions">
          {voice.isSupported && (
            <button
              type="button"
              className={`mic-btn ${voice.isListening ? "mic-btn-listening" : ""}`}
              onClick={voice.isListening ? voice.stopListening : voice.startListening}
              disabled={chat.isThinking || voice.state === "transcribing"}
              aria-label={voice.isListening ? "Stop listening and send" : "Speak your question"}
              title={voice.isListening ? "Stop listening and send" : "Speak your question"}
              aria-pressed={voice.isListening}
            >
              <i className="mic-dot" />
            </button>
          )}
          <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
          <button
            type="submit"
            className="pill-btn primary composer-send"
            disabled={chat.isThinking || draft.trim() === ""}
          >
            Send <Icon name="send" size={16} />
          </button>
        </div>
      </form>

      {speech.isSupported && speech.voices.length > 0 && (
        <label className="voice-row">
          <span>Reply voice</span>
          <select
            className="voice-select"
            value={speech.voiceURI}
            onChange={(event) => speech.selectVoice(event.target.value)}
          >
            <option value="">{speech.autoVoice ? `Automatic · ${voiceLabel(speech.autoVoice)}` : "Automatic"}</option>
            {naturalVoices.length > 0 && (
              <optgroup label="Natural">
                {naturalVoices.map((entry) => (
                  <option key={entry.voiceURI} value={entry.voiceURI}>
                    {voiceLabel(entry)}
                  </option>
                ))}
              </optgroup>
            )}
            {plainVoices.length > 0 && (
              <optgroup label="Built into Windows">
                {plainVoices.map((entry) => (
                  <option key={entry.voiceURI} value={entry.voiceURI}>
                    {voiceLabel(entry)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}
    </div>
  );
}
