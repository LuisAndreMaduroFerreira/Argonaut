import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import type { FindMarks } from "../hooks/useFind";
import { revealElement } from "../lib/findDom";
import type { Misspelling, Note, NoteGroup, SaveState, ViewMode } from "../types";
import { IMAGE_TYPES, LIMITS, SECTIONS, SPELL_LANGUAGES, isImageType } from "../types";
import { SECTION_LABELS, effectiveGroupId, flattenGroups, groupLabel } from "../lib/groups";
import { useSpellcheck } from "../hooks/useSpellcheck";
import { keepSpelling } from "../lib/spellingApi";
import { SpellMenu } from "./SpellMenu";
import { resolveApiUrl, errorMessage } from "../lib/api";
import { STORED_IMAGE, uploadImage } from "../lib/attachmentsApi";
import { applyTextEdit, continueList } from "../lib/markdownLists";
import { findWikilinks, linkText, linksTo, titleKey, type Wikilink } from "../lib/wikilinks";
import { MarkdownPreview } from "./MarkdownPreview";
import { LinkDialog } from "./LinkDialog";
import { TagInput } from "./TagInput";
import { useStableList } from "../hooks/useStableList";

interface NoteEditorProps {
  note: Note;
  viewMode: ViewMode;
  saveState: SaveState;
  onChange: (patch: Partial<Pick<Note, "title" | "content" | "tags" | "language">>) => void;
  onReplaceContent: (noteId: string, search: string, replacement: string) => void;
  // Controls for this document (view switch, read aloud), shown beside its kicker.
  tools?: ReactNode;
  // Every note, for linking and for "Linked from".
  notes: Note[];
  hasNote: (title: string) => boolean;
  // Opens the note with this title, creating it first when there isn't one.
  onOpenLink: (title: string) => void;
  // Creates a note without leaving this one, so a new link has somewhere to point.
  onCreateLinkedNote: (title: string) => void;
  onOpenNote: (id: string) => void;
  groups: NoteGroup[];
  onMoveToGroup: (groupId: string | null) => Promise<void>;
  // Find's matches in the text, drawn behind it while the find panel is open.
  findMarks?: FindMarks | null;
  // The writing area, for Find and Replace to select and edit in.
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: "Saved",
  dirty: "Unsaved · Ctrl+S to save",
  saving: "Saving…",
  error: "Couldn't save: is the API running?",
};

// The writing area grows with its text, so the page scrolls rather than a box inside it.
function fitToContent(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function relativeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function extractImages(markdown: string): { alt: string; url: string }[] {
  const images = new Map<string, string>();
  for (const match of markdown.matchAll(STORED_IMAGE)) {
    const url = match[2];
    if (url && !images.has(url)) images.set(url, match[1] ?? "");
  }
  return [...images].map(([url, alt]) => ({ url, alt }));
}

// The overlay behind the textarea repeats the text invisibly, wrapping misspelled words and
// links so their underlines land exactly under them in the text you see.
function decorated(
  text: string,
  words: Misspelling[],
  links: Wikilink[],
  hasNote: (title: string) => boolean,
): ReactNode[] {
  const marks = [
    ...words.map((entry) => ({ ...entry, link: null as Wikilink | null })),
    ...links.map((link) => ({ start: link.start, end: link.end, word: "", link })),
  ].sort((a, b) => a.start - b.start);

  const parts: ReactNode[] = [];
  let index = 0;
  for (const mark of marks) {
    if (mark.start < index || mark.end > text.length) continue;
    if (mark.start > index) parts.push(text.slice(index, mark.start));
    parts.push(
      mark.link ? (
        <mark
          key={`link-${mark.start}`}
          className={`link-mark ${hasNote(mark.link.target) ? "" : "link-mark-missing"}`}
          data-target={mark.link.target}
        >
          {text.slice(mark.start, mark.end)}
        </mark>
      ) : (
        <mark key={mark.start} className="misspelled" data-start={mark.start} data-end={mark.end}>
          {text.slice(mark.start, mark.end)}
        </mark>
      ),
    );
    index = mark.end;
  }
  // The trailing newline keeps the last line's height in step with the textarea.
  parts.push(`${text.slice(index)}\n`);
  return parts;
}

// Find's matches, in a second invisible copy of the text: all of them tinted, the current one
// stronger. An empty match (like ^) shows as a thin bar.
function findDecorated(text: string, marks: FindMarks): ReactNode[] {
  const parts: ReactNode[] = [];
  let index = 0;
  marks.matches.forEach((match, number) => {
    if (match.start < index || match.end > text.length) return;
    if (match.start > index) parts.push(text.slice(index, match.start));
    const current = number === marks.current;
    const empty = match.end === match.start;
    parts.push(
      <mark key={match.start} className={`find-mark${current ? " find-mark-current" : ""}${empty ? " find-mark-empty" : ""}`}>
        {text.slice(match.start, match.end)}
      </mark>,
    );
    index = match.end;
  });
  parts.push(`${text.slice(index)}\n`);
  return parts;
}

// The mark in the overlay under a point on screen, if any.
function markAt(overlay: HTMLElement | null, selector: string, x: number, y: number): HTMLElement | null {
  for (const mark of overlay?.querySelectorAll<HTMLElement>(selector) ?? []) {
    const hit = [...mark.getClientRects()].some(
      (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    );
    if (hit) return mark;
  }
  return null;
}

function imageFiles(files: FileList | null | undefined): File[] {
  return [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
}

// A copied picture usually arrives as a file; some apps only offer it as a clipboard item.
function pastedImages(data: DataTransfer): File[] {
  const files = imageFiles(data.files);
  if (files.length > 0) return files;
  return [...data.items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function altText(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "image";
}

export function NoteEditor({
  note,
  viewMode,
  saveState,
  onChange,
  onReplaceContent,
  tools,
  notes,
  hasNote,
  onOpenLink,
  onCreateLinkedNote,
  onOpenNote,
  groups,
  onMoveToGroup,
  findMarks,
  textareaRef,
}: NoteEditorProps) {
  const deferredContent = useDeferredValue(note.content);
  const wikilinks = useMemo(() => findWikilinks(note.content), [note.content]);
  const links = useMemo(() => [...new Map(wikilinks.map((link) => [titleKey(link.target), link.target])).values()], [
    wikilinks,
  ]);
  // The other notes keep their identity while this one is typed in, so the scan of their text
  // for links here only runs again when one of them, or this note's title, changes.
  const others = useStableList(
    useMemo(() => notes.filter((other) => other.id !== note.id), [notes, note.id]),
    (a, b) => a === b,
  );
  const noteTitle = note.title;
  const backlinks = useMemo(
    () => others.filter((other) => linksTo(other, noteTitle)),
    [others, noteTitle],
  );
  // Counted a moment behind the typing, which never waits for it.
  const wordCount = useMemo(() => countWords(deferredContent), [deferredContent]);
  const [linking, setLinking] = useState<{ start: number; end: number; text: string } | null>(null);
  const [ctrlOverLink, setCtrlOverLink] = useState(false);
  const images = useMemo(() => extractImages(note.content), [note.content]);
  const groupId = effectiveGroupId(note, groups);
  const group = groupLabel(groups, groupId);
  // Groups in Notes, the works (with their folders) in Works and the folders of Agent Skills,
  // listed apart.
  const groupOptions = useMemo(
    () => ({
      notes: flattenGroups(groups, "notes"),
      works: flattenGroups(groups, "works"),
      skills: flattenGroups(groups, "skills"),
    }),
    [groups],
  );
  const [groupError, setGroupError] = useState<string | null>(null);
  // Above the title: the note's group, which counts as its first tag.
  const kicker = group || note.tags[0] || "Note";

  const moveToGroup = (target: string | null) => {
    setGroupError(null);
    onMoveToGroup(target).catch((cause: unknown) =>
      setGroupError(errorMessage(cause, "The note couldn't be moved")),
    );
  };
  const titleRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const setContentRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      contentRef.current = element;
      if (textareaRef) textareaRef.current = element;
    },
    [textareaRef],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Where the cursor last was in the text; images land there, or at the end until you click in.
  const caretRef = useRef<{ start: number; end: number } | null>(null);
  // Changing a textarea's text from code throws its cursor to the end, so an edit made here
  // leaves the cursor it should have, applied once the text on screen matches `content`.
  const pendingCaret = useRef<{ start: number; end: number; content: string } | null>(null);
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const findOverlayRef = useRef<HTMLDivElement | null>(null);
  const spelling = useSpellcheck(note.content, note.language);

  // Each Find Next brings its match into view; typing elsewhere doesn't move the page.
  useEffect(() => {
    const mark = findOverlayRef.current?.querySelector(".find-mark-current");
    if (mark) revealElement(mark);
  }, [findMarks?.reveal]);
  const [spellMenu, setSpellMenu] = useState<Misspelling & { x: number; y: number }>();
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    caretRef.current = null;
    pendingCaret.current = null;
  }, [note.id, viewMode]);

  useLayoutEffect(() => {
    fitToContent(contentRef.current);
  }, [note.content, note.id, viewMode]);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    const textarea = contentRef.current;
    pendingCaret.current = null;
    if (pending && textarea && textarea.value === pending.content) {
      textarea.setSelectionRange(pending.start, pending.end);
    }
  }, [note.content]);

  // A different width wraps the text differently.
  useEffect(() => {
    const refit = () => fitToContent(contentRef.current);
    window.addEventListener("resize", refit);
    void document.fonts?.ready.then(refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  // A brand-new note starts on its title, selected, so typing replaces "Untitled". A new page
  // in a work already has its name ("Page 5"), so it starts on the writing itself.
  useEffect(() => {
    if (note.title === "Untitled" && note.content === "") {
      titleRef.current?.focus();
      titleRef.current?.select();
    } else if (note.content === "" && Date.now() - note.createdAt < 5000) {
      contentRef.current?.focus();
    }
    setUploadError(null);
    setGroupError(null);
    // Keyed on the note id alone: this should run when switching notes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per note, not per keystroke
  }, [note.id]);

  // Each image gets a placeholder at the cursor right away, swapped for its link once stored.
  const addImages = (files: File[]) => {
    const fits = (file: File) => isImageType(file.type) && file.size <= LIMITS.imageBytes;
    const rejected = files.find((file) => !fits(file));
    setUploadError(
      !rejected
        ? null
        : rejected.size > LIMITS.imageBytes
          ? `${rejected.name} is over ${LIMITS.imageBytes / (1024 * 1024)} MB`
          : `${rejected.name}: only PNG, JPEG, GIF and WebP images can be added`,
    );
    const accepted = files.filter(fits);
    if (accepted.length === 0) return;

    const noteId = note.id;
    const placeholders = accepted.map((file) => `![Uploading ${altText(file)}…](uploading:${crypto.randomUUID()})`);
    const caret = caretRef.current;
    const start = Math.min(caret?.start ?? note.content.length, note.content.length);
    const end = Math.min(caret?.end ?? note.content.length, note.content.length);
    // Each picture gets a line of its own. Pasted mid-sentence, it splits the sentence there,
    // without leaving a stray space at either side of the break.
    const midLine = start > 0 && note.content[start - 1] !== "\n";
    const before = midLine ? note.content.slice(0, start).replace(/[ \t]+$/, "") : note.content.slice(0, start);
    const after = midLine ? note.content.slice(end).replace(/^[ \t]+/, "") : note.content.slice(end);
    const block = (midLine ? "\n" : "") + placeholders.join("\n") + (after.startsWith("\n") ? "" : "\n");
    const content = before + block + after;
    const caretAfter = before.length + block.length;
    caretRef.current = { start: caretAfter, end: caretAfter };
    pendingCaret.current = { start: caretAfter, end: caretAfter, content };
    onChange({ content });

    // Swapping a placeholder for the stored link keeps the cursor where you've since put it.
    const swap = (placeholder: string, replacement: string) => {
      const textarea = contentRef.current;
      const at = textarea && noteIdRef.current === noteId ? textarea.value.indexOf(placeholder) : -1;
      if (textarea && at >= 0) {
        const placeholderEnd = at + placeholder.length;
        const shift = (position: number) =>
          position >= placeholderEnd
            ? position + replacement.length - placeholder.length
            : position > at
              ? at + replacement.length
              : position;
        pendingCaret.current = {
          start: shift(textarea.selectionStart),
          end: shift(textarea.selectionEnd),
          content: textarea.value.slice(0, at) + replacement + textarea.value.slice(placeholderEnd),
        };
      }
      onReplaceContent(noteId, placeholder, replacement);
    };

    accepted.forEach((file, index) => {
      const placeholder = placeholders[index]!;
      setUploading((count) => count + 1);
      uploadImage(file, noteId)
        .then(({ url }) => swap(placeholder, `![${altText(file)}](${url})`))
        .catch((cause: unknown) => {
          swap(placeholder, "");
          setUploadError(errorMessage(cause, "The image couldn't be stored"));
        })
        .finally(() => setUploading((count) => count - 1));
    });
  };

  // Right-clicking a flagged word opens Argonaut's own pane instead of the browser's menu.
  const handleContextMenu = (event: MouseEvent<HTMLTextAreaElement>) => {
    const mark = markAt(overlayRef.current, "mark.misspelled", event.clientX, event.clientY);
    if (!mark) return;
    event.preventDefault();
    setSpellMenu({
      start: Number(mark.dataset.start),
      end: Number(mark.dataset.end),
      word: mark.textContent ?? "",
      x: event.clientX,
      y: event.clientY,
    });
  };

  // Ctrl+click on a link opens its note; a plain click still just places the cursor.
  const linkUnder = (event: MouseEvent<HTMLTextAreaElement>) =>
    event.ctrlKey || event.metaKey ? markAt(overlayRef.current, "mark.link-mark", event.clientX, event.clientY) : null;

  const startLinking = () => {
    const textarea = contentRef.current;
    const start = textarea?.selectionStart ?? note.content.length;
    const end = textarea?.selectionEnd ?? start;
    setLinking({ start, end, text: note.content.slice(start, end) });
  };

  // The selected words become [[Note title|words]], or [[Note title]] with nothing selected.
  const finishLinking = (title: string) => {
    const target = linking;
    const textarea = contentRef.current;
    setLinking(null);
    if (!target || !textarea) return;
    const insert = linkText(title, target.text || title);
    textarea.focus();
    applyTextEdit(
      textarea,
      { from: target.start, to: target.end, insert, caret: target.start + insert.length },
      (content) => onChange({ content }),
    );
  };

  const acceptSuggestion = (suggestion: string) => {
    const textarea = contentRef.current;
    if (spellMenu && textarea) {
      textarea.focus();
      applyTextEdit(
        textarea,
        { from: spellMenu.start, to: spellMenu.end, insert: suggestion, caret: spellMenu.start + suggestion.length },
        (content) => onChange({ content }),
      );
    }
    setSpellMenu(undefined);
  };

  const keepMySpelling = () => {
    if (spellMenu && spelling.language) {
      const word = spellMenu.word;
      spelling.forget(word);
      keepSpelling(word, spelling.language).catch(() => {
        // Keeping it is a convenience; the word simply gets flagged again next time.
      });
    }
    setSpellMenu(undefined);
  };

  const acceptDrop = (event: DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  };

  const handleDrop = (event: DragEvent) => {
    const files = imageFiles(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    addImages(files);
  };

  const flagged = note.language === "off" ? 0 : spelling.words.length;

  return (
    <div className="editor-scroll">
      <article className="doc" onDragOver={acceptDrop} onDrop={handleDrop}>
        <header className="doc-header">
          <div className="doc-topline">
            <div className="kicker">{kicker}</div>
            <div className="doc-tools">
              {viewMode === "edit" && (
                <button
                  type="button"
                  className="tool-btn"
                  // Keeps the text selection, so the selected words are what gets linked.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={startLinking}
                  title="Link the selected words to a note (Ctrl+L)"
                >
                  <Icon name="link" />
                  <span className="tool-btn-label">Link</span>
                </button>
              )}
              {tools}
            </div>
          </div>
          <input
            ref={titleRef}
            className="title-input"
            value={note.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Untitled"
            aria-label="Note title"
          />
          <div className="doc-meta">
            <span>Edited {relativeTime(note.updatedAt)}</span>
            <span className="doc-meta-sep" aria-hidden="true">
              ·
            </span>
            <span>{wordCount.toLocaleString()} words</span>
            <span className="doc-meta-sep" aria-hidden="true">
              ·
            </span>
            <span className={`save-status save-status-${saveState}`}>{SAVE_LABELS[saveState]}</span>
            {flagged > 0 && (
              <>
                <span className="doc-meta-sep" aria-hidden="true">
                  ·
                </span>
                <span>
                  {flagged} spelling {flagged === 1 ? "issue" : "issues"}
                </span>
              </>
            )}
            {uploading > 0 && (
              <>
                <span className="doc-meta-sep" aria-hidden="true">
                  ·
                </span>
                <span>Uploading image…</span>
              </>
            )}
            {uploadError && (
              <>
                <span className="doc-meta-sep" aria-hidden="true">
                  ·
                </span>
                <span className="doc-meta-error" role="alert">
                  {uploadError}
                </span>
              </>
            )}
            <button
              type="button"
              className={`details-toggle ${detailsOpen ? "details-toggle-open" : ""}`}
              aria-expanded={detailsOpen}
              aria-controls="doc-details"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              Details
              <Icon name="chevron" size={16} />
            </button>
          </div>

          <section id="doc-details" className="doc-details" aria-label="Note details" hidden={!detailsOpen}>
            <div className="detail-row">
              <label className="detail-label" htmlFor="note-group">
                Group
              </label>
              <div className="detail-value">
                <select
                  id="note-group"
                  className="detail-input detail-select"
                  value={groupId ?? ""}
                  onChange={(event) => moveToGroup(event.target.value || null)}
                >
                  <option value="">No group</option>
                  {SECTIONS.map(
                    (section) =>
                      groupOptions[section].length > 0 && (
                        <optgroup key={section} label={SECTION_LABELS[section]}>
                          {groupOptions[section].map(({ group: option, label }) => (
                            <option key={option.id} value={option.id}>
                              {label}
                            </option>
                          ))}
                        </optgroup>
                      ),
                  )}
                </select>
                <span className={groupError ? "detail-note doc-meta-error" : "detail-note"} role={groupError ? "alert" : undefined}>
                  {groupError ??
                    (groupOptions.notes.length + groupOptions.works.length + groupOptions.skills.length === 0
                      ? "Make groups with the folder button beside Notes in the sidebar"
                      : "Or drag the note onto a group or work in the sidebar")}
                </span>
              </div>
            </div>
            <div className="detail-row">
              <label className="detail-label" htmlFor="note-tags">
                Tags
              </label>
              <TagInput
                id="note-tags"
                tags={note.tags}
                onChange={(tags) => onChange({ tags })}
                group={group ? { label: group, onRemove: () => moveToGroup(null) } : null}
              />
            </div>
            <div className="detail-row">
              <label className="detail-label" htmlFor="note-spelling">
                Spelling
              </label>
              <div className="detail-value">
                <select
                  id="note-spelling"
                  className="detail-input detail-select"
                  value={note.language}
                  onChange={(event) => onChange({ language: event.target.value })}
                >
                  <option value="">
                    {spelling.language ? `Automatic · ${SPELL_LANGUAGES[spelling.language]}` : "Automatic"}
                  </option>
                  {Object.entries(SPELL_LANGUAGES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                  <option value="off">Off</option>
                </select>
                <span className="detail-note">
                  {note.language === "off"
                    ? "Not checked"
                    : spelling.unavailable
                      ? "The spell checker isn't answering"
                      : flagged === 0
                        ? "Nothing flagged"
                        : "Right-click an underlined word"}
                </span>
              </div>
            </div>
            <div className="detail-row">
              <span className="detail-label">Links to</span>
              <div className="detail-value">
                {links.length === 0 ? (
                  <span className="detail-note">None yet: select words and press Ctrl+L to link them</span>
                ) : (
                  <ul className="chip-list">
                    {links.map((target) => (
                      <li key={target}>
                        <button
                          type="button"
                          className={`chip chip-link ${hasNote(target) ? "" : "chip-link-missing"}`}
                          onClick={() => onOpenLink(target)}
                          title={hasNote(target) ? `Open “${target}”` : `No note called “${target}” yet: create it`}
                        >
                          {target}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="detail-row">
              <span className="detail-label">Linked from</span>
              <div className="detail-value">
                {backlinks.length === 0 ? (
                  <span className="detail-note">No other note links here yet</span>
                ) : (
                  <ul className="chip-list">
                    {backlinks.map((other) => (
                      <li key={other.id}>
                        <button type="button" className="chip chip-link" onClick={() => onOpenNote(other.id)}>
                          {other.title || "Untitled"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="detail-row">
              <span className="detail-label">Images</span>
              <div className="detail-value">
                {images.length > 0 && (
                  <div className="detail-images">
                    {images.map((image) => (
                      <img key={image.url} src={resolveApiUrl(image.url)} alt={image.alt} title={image.alt} />
                    ))}
                  </div>
                )}
                <button type="button" className="ghost-btn" onClick={() => fileInputRef.current?.click()}>
                  <Icon name="plus" size={16} />
                  Add image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMAGE_TYPES.join(",")}
                  multiple
                  hidden
                  onChange={(event) => {
                    addImages(imageFiles(event.target.files));
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
          </section>
        </header>

        {viewMode === "edit" ? (
          <div className={`content-area ${ctrlOverLink ? "link-hover" : ""}`}>
            {findMarks && findMarks.matches.length > 0 && (
              <div className="find-overlay" ref={findOverlayRef} aria-hidden="true">
                {findDecorated(note.content, findMarks)}
              </div>
            )}
            <div className="spell-overlay" ref={overlayRef} aria-hidden="true">
              {decorated(note.content, spelling.words, wikilinks, hasNote)}
            </div>
            <textarea
              ref={setContentRef}
              className="content-input"
              value={note.content}
              onChange={(event) => onChange({ content: event.target.value })}
              onScroll={(event) => {
                if (overlayRef.current) overlayRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
              onContextMenu={handleContextMenu}
              onClick={(event) => {
                const link = linkUnder(event);
                if (!link) return;
                event.preventDefault();
                setCtrlOverLink(false);
                onOpenLink(link.dataset.target ?? "");
              }}
              onMouseMove={(event) => setCtrlOverLink(linkUnder(event) !== null)}
              onMouseLeave={() => setCtrlOverLink(false)}
              onSelect={(event) => {
                caretRef.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                };
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
                  event.preventDefault();
                  startLinking();
                  return;
                }
                // Enter continues a list; Shift+Enter is a plain new line.
                if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
                  return;
                }
                if (event.nativeEvent.isComposing) return;
                const textarea = event.currentTarget;
                if (textarea.selectionStart !== textarea.selectionEnd) return;
                const edit = continueList(textarea.value, textarea.selectionStart);
                if (!edit) return;
                event.preventDefault();
                applyTextEdit(textarea, edit, (content) => onChange({ content }));
              }}
              onPaste={(event) => {
                const files = pastedImages(event.clipboardData);
                if (files.length === 0) return;
                event.preventDefault();
                // The picture goes exactly where the cursor is now, replacing any selected text.
                const textarea = event.currentTarget;
                caretRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
                addImages(files);
              }}
              placeholder="Write in Markdown… select words and press Ctrl+L to link them to another note"
              aria-label="Note content"
              spellCheck={false}
            />
          </div>
        ) : (
          <MarkdownPreview markdown={note.content} hasNote={hasNote} onOpenLink={onOpenLink} />
        )}
      </article>
      {linking && (
        <LinkDialog
          notes={notes}
          currentNoteId={note.id}
          selectedText={linking.text}
          onChoose={finishLinking}
          onCreate={(title) => {
            onCreateLinkedNote(title);
            finishLinking(title);
          }}
          onClose={() => setLinking(null)}
        />
      )}
      {spellMenu && spelling.language && (
        <SpellMenu
          word={spellMenu.word}
          language={spelling.language}
          x={spellMenu.x}
          y={spellMenu.y}
          onAccept={acceptSuggestion}
          onKeep={keepMySpelling}
          onClose={() => setSpellMenu(undefined)}
        />
      )}
    </div>
  );
}
