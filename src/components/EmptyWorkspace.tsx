import { MOD_KEY } from "../lib/platform";
import { ArgonautMark } from "./ArgonautMark";

interface EmptyWorkspaceProps {
  onNewNote: () => void;
  onOpenMissions: () => void;
  onOpenTests: () => void;
}

// What the document area shows when no tab is open.
export function EmptyWorkspace({ onNewNote, onOpenMissions, onOpenTests }: EmptyWorkspaceProps) {
  return (
    <div className="pane-center">
      <div className="empty-workspace">
        <ArgonautMark size={44} />
        <p className="empty-title">Nothing open</p>
        <p className="empty-copy">Pick a note from the sidebar, or start something new.</p>
        <div className="empty-actions">
          <button type="button" className="pill-btn primary" onClick={onNewNote}>
            New note
          </button>
          <button type="button" className="pill-btn" onClick={onOpenMissions}>
            Open missions
          </button>
          <button type="button" className="pill-btn" onClick={onOpenTests}>
            Open tests
          </button>
        </div>
        <p className="empty-keys">
          {MOD_KEY} K search · {MOD_KEY} S save · {MOD_KEY} / all shortcuts
        </p>
      </div>
    </div>
  );
}
