import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "./useFocusTrap";

// The app's own confirmations and error notices, in place of window.confirm and alert: those
// are unstyled, block the whole window, say "localhost:8787 says" and can't be tested.

export interface Choice<K extends string> {
  key: K;
  label: string;
  // The highlighted choice, which Enter picks.
  primary?: boolean;
}

export interface ChooseOptions<K extends string> {
  title: string;
  message?: string;
  choices: Choice<K>[];
  // The label of the button that picks nothing, as Escape does.
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface Notice {
  id: number;
  title: string;
  message: string;
}

interface Dialogs {
  // Resolves with the key picked, or null when cancelled.
  choose<K extends string>(options: ChooseOptions<K>): Promise<K | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  // A failure worth telling, shown in the pop-up stack without stopping anything.
  notify(title: string, message: string): void;
  notices: Notice[];
  dismissNotice(id: number): void;
}

interface Pending {
  id: number;
  options: ChooseOptions<string>;
  resolve: (key: string | null) => void;
}

const NOTICE_MS = 12_000;

const DialogsContext = createContext<Dialogs | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }) {
  // One question at a time; later ones wait their turn.
  const [queue, setQueue] = useState<Pending[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextNotice = useRef(0);
  const nextQuestion = useRef(0);

  const choose = useCallback(
    <K extends string>(options: ChooseOptions<K>) =>
      new Promise<K | null>((resolve) => {
        nextQuestion.current += 1;
        const id = nextQuestion.current;
        setQueue((current) => [...current, { id, options, resolve: resolve as (key: string | null) => void }]);
      }),
    [],
  );

  const confirm = useCallback(
    async ({ title, message, confirmLabel = "OK", cancelLabel }: ConfirmOptions) =>
      (await choose({ title, message, cancelLabel, choices: [{ key: "ok", label: confirmLabel, primary: true }] })) ===
      "ok",
    [choose],
  );

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback(
    (title: string, message: string) => {
      nextNotice.current += 1;
      const id = nextNotice.current;
      setNotices((current) => [...current, { id, title, message }]);
      window.setTimeout(() => dismissNotice(id), NOTICE_MS);
    },
    [dismissNotice],
  );

  const answer = useCallback((key: string | null) => {
    setQueue(([first, ...rest]) => {
      first?.resolve(key);
      return rest;
    });
  }, []);

  const value = useMemo(
    () => ({ choose, confirm, notify, notices, dismissNotice }),
    [choose, confirm, notify, notices, dismissNotice],
  );

  const current = queue[0];
  return (
    <DialogsContext.Provider value={value}>
      {children}
      {/* Keyed, so a queued question gets fresh focus handling. */}
      {current && <QuestionDialog key={current.id} options={current.options} onAnswer={answer} />}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogsContext);
  if (!dialogs) throw new Error("useDialogs must be used inside DialogsProvider");
  return dialogs;
}

function QuestionDialog({ options, onAnswer }: { options: ChooseOptions<string>; onAnswer: (key: string | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cancel = useCallback(() => onAnswer(null), [onAnswer]);
  useFocusTrap(ref, true, cancel);

  return (
    <div className="dialog-layer">
      <div className="scrim" aria-hidden="true" onClick={cancel} />
      <div
        ref={ref}
        className="dialog question-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="question-title"
        aria-describedby={options.message ? "question-message" : undefined}
        tabIndex={-1}
      >
        <div className="dialog-body">
          <h2 id="question-title" className="question-title">
            {options.title}
          </h2>
          {options.message && (
            <p id="question-message" className="question-message">
              {options.message}
            </p>
          )}
          <div className="dialog-footer">
            <button type="button" className="pill-btn" onClick={cancel}>
              {options.cancelLabel ?? "Cancel"}
            </button>
            {options.choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                className={`pill-btn${choice.primary ? " primary" : ""}`}
                data-autofocus={choice.primary || undefined}
                onClick={() => onAnswer(choice.key)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// The notices, inside the app's pop-up stack (see App).
export function Notices() {
  const { notices, dismissNotice } = useDialogs();
  return (
    <div className="toast-list" aria-live="assertive">
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} onDismiss={dismissNotice} />
      ))}
    </div>
  );
}

function NoticeCard({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  return (
    <div className="toast toast-notice" role="alert" title="Dismiss" onClick={() => onDismiss(notice.id)}>
      <div className="toast-kicker">{notice.title}</div>
      <div className="toast-meta">{notice.message}</div>
    </div>
  );
}
