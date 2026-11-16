import { useMissions } from "../hooks/useMissions";
import { CADENCE_LABELS, streakLabel, timeLeft } from "../lib/missionFormat";
import type { ToastContent } from "../types";
import { ProgressBar } from "./ProgressBar";

function ToastBody({ content }: { content: ToastContent }) {
  switch (content.kind) {
    case "completed": {
      const streak = streakLabel(content.streak, content.cadence);
      return (
        <>
          <div className="toast-kicker">Task complete</div>
          <div className="toast-title">{content.title}</div>
          <div className="toast-meta">
            {content.done}/{content.total} {CADENCE_LABELS[content.cadence].toLowerCase()}
            {streak ? ` · ${streak}` : ""}
          </div>
          <ProgressBar value={content.done} max={content.total} />
        </>
      );
    }
    case "changed":
      return (
        <>
          <div className="toast-kicker">{content.action}</div>
          <div className="toast-title">{content.title}</div>
        </>
      );
    case "briefing":
      return (
        <>
          <div className="toast-kicker">Today's tasks</div>
          <div className="toast-title">
            {content.done === content.total ? "All done" : `${content.done}/${content.total} daily`}
          </div>
          <div className="toast-meta">resets in {timeLeft(content.endsAt, Date.now())}</div>
        </>
      );
    case "error":
      return (
        <>
          <div className="toast-kicker">Couldn't change tasks</div>
          <div className="toast-meta">{content.message}</div>
        </>
      );
  }
}

// The task pop-ups, inside the app's pop-up stack (see App).
export function MissionToasts() {
  const { toasts, dismiss } = useMissions();

  return (
    <div className="toast-list" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.content.kind}`}
          role="status"
          title="Dismiss"
          onClick={() => dismiss(toast.id)}
        >
          <ToastBody content={toast.content} />
        </div>
      ))}
    </div>
  );
}
