import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import type { SaveFailure } from "../hooks/useNotes";
import type { SaveState } from "../types";
import { Icon } from "./Icon";

interface SaveAlertProps {
  failure: SaveFailure | null;
  // The note it's about, as it stands now: a save that works turns the pop-up into "Saved".
  title: string;
  saveState: SaveState | null;
  onRetry: () => void;
  onDismiss: (id: number) => void;
}

const SHOWN_MS = 10_000;
const SAVED_MS = 1_800;
// Matches save-alert-sink in styles/toasts.css.
const LEAVE_MS = 260;

// A save that didn't reach the database, told by a pop-up that rises from the window's bottom
// edge. Each failed save brings it up again; it sinks away after a while, or soon after the
// note is saved, but stays while it's pointed at or used from the keyboard.
export function SaveAlert(props: SaveAlertProps) {
  return props.failure ? <SaveAlertCard {...props} failure={props.failure} /> : null;
}

function SaveAlertCard({ failure, title, saveState, onRetry, onDismiss }: SaveAlertProps & { failure: SaveFailure }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Where the focus came from, to give it back when the pop-up goes.
  const returnFocus = useRef<HTMLElement | null>(null);
  const hadFocus = useRef(false);
  const firstId = useRef(failure.id);
  const [shownId, setShownId] = useState(failure.id);
  const [leaving, setLeaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  // Another failed save: the same pop-up comes up again as new, so the focus stays where it is.
  if (failure.id !== shownId) {
    setShownId(failure.id);
    setLeaving(false);
    setSaved(false);
  }
  // Once saved it says so, even if typing makes the note unsaved again.
  if (saveState === "saved" && !saved) setSaved(true);
  const saving = saveState === "saving";

  // The first rise runs as the pop-up mounts; a repeat restarts it.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || shownId === firstId.current) return;
    card.style.animation = "none";
    void card.offsetHeight;
    card.style.animation = "";
  }, [shownId]);

  // "Try again" is gone once saved. Removing a focused button fires no blur, so the focus is
  // moved on to Dismiss by hand.
  useLayoutEffect(() => {
    if (saved && focusInside && document.activeElement === document.body) closeRef.current?.focus();
  }, [saved, focusInside]);

  // Being used holds a failure up; a "Saved" goes unless the pointer is on it.
  const held = pointerInside || (focusInside && !saved);
  useEffect(() => {
    if (leaving || held || saving) return;
    const timer = window.setTimeout(() => setLeaving(true), saved ? SAVED_MS : SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, held, saving, saved, shownId]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onDismiss(failure.id), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onDismiss, failure.id]);

  // Leaving with the focus inside hands it back, usually to the note being written.
  useEffect(() => {
    hadFocus.current = focusInside;
  }, [focusInside]);
  useEffect(
    () => () => {
      if (hadFocus.current && document.activeElement === document.body) returnFocus.current?.focus();
    },
    [],
  );

  const takeFocus = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) returnFocus.current = from;
    setFocusInside(true);
  };
  const loseFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false);
  };

  return (
    <div
      ref={cardRef}
      className={`save-alert${saved ? " save-alert-saved" : ""}${leaving ? " save-alert-leaving" : ""}`}
      role="alert"
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
      onFocus={takeFocus}
      onBlur={loseFocus}
    >
      <div className="toast-kicker">{saved ? "Saved" : failure.attempt > 1 ? "Still not saved" : "Couldn't save"}</div>
      <div className="toast-title">“{title.trim() || "Untitled"}”</div>
      {saved ? (
        <p className="toast-meta">It's in the database now.</p>
      ) : failure.unreachable ? (
        <>
          <p className="toast-meta">
            Argonaut's services aren't answering, so Docker or WSL is probably down. Your changes stay in this window.
          </p>
          <p className="toast-meta">Run Argonaut.exe to bring them back, then press Try again.</p>
        </>
      ) : (
        <p className="toast-meta">The server turned it down: {failure.message}</p>
      )}
      {!saved && (
        <div className="save-alert-actions">
          {/* aria-disabled rather than disabled, which would drop the focus while it saves. */}
          <button
            type="button"
            className="pill-btn primary save-alert-retry"
            aria-disabled={saving || undefined}
            onClick={saving ? undefined : onRetry}
          >
            {saving ? "Saving…" : "Try again"}
          </button>
        </div>
      )}
      <button
        ref={closeRef}
        type="button"
        className="icon-btn save-alert-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => setLeaving(true)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
