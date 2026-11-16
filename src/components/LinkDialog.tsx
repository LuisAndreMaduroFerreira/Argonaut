import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Note } from "../types";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { titleKey } from "../lib/wikilinks";
import { Icon } from "./Icon";

interface LinkDialogProps {
  notes: Note[];
  currentNoteId: string;
  selectedText: string;
  onChoose: (title: string) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}

type Option = { kind: "note"; note: Note } | { kind: "create"; title: string };

const MAX_SHOWN = 8;

// "prepositions" should find "Les prépositions", so accents are ignored while searching.
function plain(text: string): string {
  return titleKey(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function rank(title: string, query: string): number {
  const name = plain(title);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(" ").some((word) => word.startsWith(query))) return 2;
  return name.includes(query) ? 3 : -1;
}

export function LinkDialog({ notes, currentNoteId, selectedText, onChoose, onCreate, onClose }: LinkDialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState(selectedText.trim());
  const [active, setActive] = useState(0);
  useFocusTrap(ref, true, onClose);

  const options = useMemo<Option[]>(() => {
    const wanted = plain(query);
    const others = notes.filter((note) => note.id !== currentNoteId && note.title.trim() !== "");
    const matches = wanted
      ? others
          .map((note) => ({ note, score: rank(note.title, wanted) }))
          .filter((entry) => entry.score >= 0)
          .sort((a, b) => a.score - b.score || b.note.updatedAt - a.note.updatedAt)
          .map((entry) => entry.note)
      : [...others].sort((a, b) => b.updatedAt - a.updatedAt);
    const list: Option[] = matches.slice(0, MAX_SHOWN).map((note) => ({ kind: "note", note }));
    const exact = matches.some((note) => plain(note.title) === wanted);
    if (query.trim() && !exact) list.push({ kind: "create", title: query.trim() });
    return list;
  }, [notes, currentNoteId, query]);

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.kind === "note") onChoose(option.note.title);
    else onCreate(option.title);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + options.length) % Math.max(options.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[Math.min(active, options.length - 1)]);
    }
  };

  const activeIndex = Math.min(active, options.length - 1);

  return (
    <div className="dialog-layer">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className="dialog link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-title"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id="link-title" className="dialog-title">
            Link to a note
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">
          {selectedText.trim() && (
            <p className="dialog-intro">
              The words <strong>“{selectedText.trim()}”</strong> will link to the note you pick.
            </p>
          )}
          <div className="link-search">
            <Icon name="search" size={16} />
            <input
              data-autofocus
              className="link-search-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Find a note by title"
              role="combobox"
              aria-expanded="true"
              aria-controls="link-options"
              aria-activedescendant={options.length > 0 ? `link-option-${activeIndex}` : undefined}
              aria-label="Find a note by title"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ul id="link-options" className="link-options" role="listbox" aria-label="Notes">
            {options.length === 0 && <li className="link-empty">No other notes yet. Type a title to create one.</li>}
            {options.map((option, index) => (
              <li
                key={option.kind === "note" ? option.note.id : "create"}
                id={`link-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`link-option ${index === activeIndex ? "link-option-active" : ""} link-option-${option.kind}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <Icon name={option.kind === "note" ? "note" : "plus"} size={16} />
                {option.kind === "note" ? (
                  <span className="link-option-title">{option.note.title}</span>
                ) : (
                  <span className="link-option-title">
                    Create a new note <strong>“{option.title}”</strong>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="link-hint">↑ ↓ to choose · Enter to link · Esc to cancel</p>
        </div>
      </div>
    </div>
  );
}
