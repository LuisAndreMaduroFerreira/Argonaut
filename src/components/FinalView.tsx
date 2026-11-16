import { useEffect, useState } from "react";
import { countWords } from "../lib/finalView";
import { Icon } from "./Icon";
import { MarkdownPreview } from "./MarkdownPreview";

// A work's pages joined into one text, as it stood when generated. It lives only in its tab:
// closing the tab discards it, and nothing about it is stored.
export interface FinalViewData {
  groupId: string;
  name: string;
  text: string;
  pages: number;
  generatedAt: number;
}

interface FinalViewProps {
  view: FinalViewData;
  hasNote: (title: string) => boolean;
  onOpenLink: (title: string) => void;
  // null once the work has been deleted: the view stays as it was, but can't be joined again.
  onRefresh: (() => void) | null;
  onExport: () => void;
}

export function FinalView({ view, hasNote, onOpenLink, onRefresh, onExport }: FinalViewProps) {
  const [copied, setCopied] = useState(false);
  const words = countWords(view.text);
  const time = new Date(view.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="editor-scroll">
      <article className="doc final-view" aria-label={`Final view of ${view.name}`}>
        <header className="doc-header">
          <div className="doc-topline">
            <div className="kicker">Final view</div>
            <div className="doc-tools">
              <button
                type="button"
                className="tool-btn"
                onClick={onRefresh ?? undefined}
                disabled={onRefresh === null}
                title={onRefresh ? "Join the pages again as they are now" : "This work no longer exists"}
              >
                <Icon name="refresh" />
                <span className="tool-btn-label">Refresh</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                disabled={view.text === ""}
                onClick={() => void navigator.clipboard.writeText(view.text).then(() => setCopied(true))}
              >
                <Icon name="copy" />
                <span className="tool-btn-label">{copied ? "Copied" : "Copy text"}</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                disabled={view.text === ""}
                onClick={onExport}
                title="Save as a Markdown file in Downloads"
              >
                <Icon name="download" />
                <span className="tool-btn-label">Export .md</span>
              </button>
            </div>
          </div>
          <h1 className="final-view-title">{view.name}</h1>
          <div className="doc-meta">
            <span>
              {view.pages} {view.pages === 1 ? "page" : "pages"}
            </span>
            <span className="doc-meta-sep" aria-hidden="true">
              ·
            </span>
            <span>{words.toLocaleString()} words</span>
            <span className="doc-meta-sep" aria-hidden="true">
              ·
            </span>
            <span>Generated at {time}; closing this tab discards it</span>
          </div>
        </header>
        {view.text ? (
          <MarkdownPreview markdown={view.text} hasNote={hasNote} onOpenLink={onOpenLink} breaks />
        ) : (
          <p className="missions-empty">This work has no pages with text yet.</p>
        )}
      </article>
    </div>
  );
}
