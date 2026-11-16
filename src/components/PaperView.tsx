import { useEffect, useImperativeHandle, useState, type FormEvent, type MutableRefObject, type Ref } from "react";
import type { Paper, PaperFolder, PaperPatch } from "../types";
import { downloadPaper, formatBytes, paperFileUrl } from "../lib/papersApi";
import { Icon } from "./Icon";
import { errorMessage } from "../lib/api";

// A paper in the document area: its details on top (editable under Details), and the PDF
// itself below, in the browser's own viewer: zoom, pages, and search inside it with Ctrl+F once
// it has the focus.

interface PaperViewProps {
  paper: Paper;
  folders: PaperFolder[];
  frameRef: MutableRefObject<HTMLIFrameElement | null>;
  handle: Ref<PaperViewHandle>;
  onSave: (patch: PaperPatch) => Promise<void>;
  onDelete: () => void;
}

export interface PaperViewHandle {
  // Ctrl+F was pressed outside the PDF: says how searching it works.
  showSearchHint(): void;
}

interface Draft {
  title: string;
  authors: string;
  year: string;
  doi: string;
  folderId: string;
}

const draftOf = (paper: Paper): Draft => ({
  title: paper.title,
  authors: paper.authors,
  year: paper.year === null ? "" : String(paper.year),
  doi: paper.doi,
  folderId: paper.folderId ?? "",
});

export function PaperView({ paper, folders, frameRef, handle, onSave, onDelete }: PaperViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(paper));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // When the search hint goes away, or null while it isn't shown.
  const [hintUntil, setHintUntil] = useState<number | null>(null);
  const hintShown = hintUntil !== null;
  const url = paperFileUrl(paper.id);
  const folder = folders.find((candidate) => candidate.id === paper.folderId);

  // Another paper, or the same one changed elsewhere: the form starts from what's stored.
  useEffect(() => {
    setDraft(draftOf(paper));
    setError(null);
  }, [paper]);

  useEffect(() => {
    setEditing(false);
  }, [paper.id]);

  useImperativeHandle(handle, () => ({ showSearchHint: () => setHintUntil(Date.now() + 6000) }), []);

  useEffect(() => {
    if (hintUntil === null) return;
    const timer = window.setTimeout(() => setHintUntil(null), hintUntil - Date.now());
    return () => window.clearTimeout(timer);
  }, [hintUntil]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const year = draft.year.trim();
    if (year !== "" && !/^\d{4}$/.test(year)) {
      setError("The year is four digits, like 2017, or nothing");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: draft.title,
        authors: draft.authors,
        year: year === "" ? null : Number(year),
        doi: draft.doi,
        folderId: draft.folderId || null,
      });
      setEditing(false);
    } catch (cause) {
      setError(errorMessage(cause, "The details couldn't be saved"));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Draft, label: string, extra: { placeholder?: string; inputMode?: "numeric" } = {}) => (
    <div className="paper-field">
      <label className="detail-label" htmlFor={`paper-${key}`}>
        {label}
      </label>
      <input
        id={`paper-${key}`}
        className="detail-input"
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        {...extra}
      />
    </div>
  );

  const meta = [
    paper.authors,
    paper.year ? String(paper.year) : "",
    paper.pages ? `${paper.pages} ${paper.pages === 1 ? "page" : "pages"}` : "",
    formatBytes(paper.byteSize),
  ].filter(Boolean);

  return (
    <div className="paper-view">
      <header className="paper-header">
        <div className="paper-heading">
          <div className="kicker">{folder?.name ?? "Paper"}</div>
          <h1 className="paper-title">{paper.title}</h1>
          <p className="paper-meta">
            {meta.map((part, index) => (
              <span key={index}>
                {index > 0 && <span className="doc-meta-sep" aria-hidden="true"> · </span>}
                {part}
              </span>
            ))}
            {paper.doi && (
              <>
                <span className="doc-meta-sep" aria-hidden="true">
                  {" "}
                  ·{" "}
                </span>
                <a className="paper-doi" href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer">
                  doi:{paper.doi}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="paper-tools">
          <button
            type="button"
            className={`details-toggle ${editing ? "details-toggle-open" : ""}`}
            aria-expanded={editing}
            aria-controls="paper-details"
            onClick={() => setEditing((open) => !open)}
          >
            Details
            <Icon name="chevron" size={16} />
          </button>
          <a className="tool-btn" href={url} target="_blank" rel="noopener" title="Open the PDF in a window of its own">
            <Icon name="external" />
            <span className="tool-btn-label">Open in a window</span>
          </a>
          <button
            type="button"
            className="tool-btn"
            onClick={() =>
              downloadPaper(paper).catch((cause: unknown) =>
                setError(errorMessage(cause, "The PDF couldn't be saved")),
              )
            }
            title={`Save ${paper.fileName || "the PDF"} to Downloads`}
          >
            <Icon name="download" />
            <span className="tool-btn-label">Download</span>
          </button>
        </div>

        <form
          id="paper-details"
          className="paper-details"
          hidden={!editing}
          onSubmit={save}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(draftOf(paper));
              setEditing(false);
            }
          }}
          aria-label="Paper details"
        >
          {field("title", "Title")}
          {field("authors", "Authors", { placeholder: "Separated by commas" })}
          <div className="paper-field-row">
            {field("year", "Year", { inputMode: "numeric", placeholder: "e.g. 2017" })}
            {field("doi", "DOI", { placeholder: "10.1000/xyz123" })}
          </div>
          <div className="paper-field">
            <label className="detail-label" htmlFor="paper-folder">
              Folder
            </label>
            <select
              id="paper-folder"
              className="detail-input detail-select"
              value={draft.folderId}
              onChange={(event) => setDraft({ ...draft, folderId: event.target.value })}
            >
              <option value="">No folder</option>
              {folders.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="paper-form-actions">
            <button type="submit" className="pill-btn primary" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </button>
            <button
              type="button"
              className="pill-btn"
              onClick={() => {
                setDraft(draftOf(paper));
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button type="button" className="ghost-btn danger paper-delete" onClick={onDelete}>
              Delete paper
            </button>
          </div>
        </form>
        {error && (
          <p className="doc-meta-error paper-error" role="alert">
            {error}
          </p>
        )}
        <p className="paper-hint" role="status">
          {hintShown ? "To search inside the paper, it now has the focus: press Ctrl+F again." : ""}
        </p>
      </header>
      <iframe ref={frameRef} key={paper.id} className="paper-frame" src={url} title={`${paper.title}, PDF`} />
    </div>
  );
}
