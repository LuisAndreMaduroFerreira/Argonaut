import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import type {
  Note,
  NoteGroup,
  Paper,
  PaperFolder,
  Section,
  SidebarSection,
  TestFolder,
  TestSummary,
  Theme,
} from "../types";
import { SECTIONS } from "../types";
import { useDesktopShortcut } from "../hooks/useDesktopShortcut";
import { useDialogs } from "../hooks/useDialogs";
import { errorMessage } from "../lib/api";
import type { PapersNotice } from "../hooks/usePapers";
import { SECTION_LABELS, flattenGroups, groupLabel, notesDirectlyIn, sectionOf, visibleNoteOrder } from "../lib/groups";
import { ArgonautMark } from "./ArgonautMark";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import { NoteTree, type Dragged } from "./NoteTree";
import { PaperTree, describePaper } from "./PaperTree";
import { TestTree } from "./TestTree";

interface NotesMenuProps {
  notes: Note[];
  groups: NoteGroup[];
  ids: string[];
  at: { x: number; y: number };
  // Opened straight on the destinations, from the selection bar's Move to…
  startMoving: boolean;
  onOpen: () => void;
  onMove: (groupId: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}

// The menu of one note, or of the notes picked together: open, move, delete.
function NotesMenu({ notes, groups, ids, at, startMoving, onOpen, onMove, onDelete, onClose }: NotesMenuProps) {
  const [moving, setMoving] = useState(startMoving);
  const single = ids.length === 1 ? notes.find((note) => note.id === ids[0]) : undefined;
  const what = single ? `“${single.title || "Untitled"}”` : `${ids.length} notes`;
  const destinations = [
    { heading: "Notes", items: [{ id: null as string | null, label: "Top level" }, ...flattenGroups(groups, "notes").map((row) => ({ id: row.group.id as string | null, label: row.label }))] },
    { heading: "Works", items: flattenGroups(groups, "works").map((row) => ({ id: row.group.id as string | null, label: row.label })) },
    { heading: SECTION_LABELS.skills, items: flattenGroups(groups, "skills").map((row) => ({ id: row.group.id as string | null, label: row.label })) },
  ].filter((part) => part.items.length > 0);
  const choose = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Menu
      label={`${what}: actions`}
      at={at}
      focusKey={moving}
      onEscape={() => (moving && !startMoving ? setMoving(false) : onClose())}
      onDismiss={onClose}
    >
      {moving ? (
        <>
          <p className="row-menu-heading">Move {what} to</p>
          {destinations.map((part) => (
            <div key={part.heading} role="group" aria-label={part.heading}>
              <p className="row-menu-subheading">{part.heading}</p>
              {part.items.map((destination) => (
                <button
                  key={destination.id ?? "top"}
                  type="button"
                  role="menuitem"
                  className="row-menu-item"
                  onClick={choose(() => onMove(destination.id))}
                >
                  <Icon name={destination.id === null ? "menu" : part.heading === "Works" ? "book" : "folder"} size={16} />
                  <span>{destination.label}</span>
                </button>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="row-menu-item" onClick={choose(onOpen)}>
            <span>{single ? "Open" : `Open ${ids.length} notes`}</span>
          </button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={() => setMoving(true)}>
            <span>Move to…</span>
          </button>
          <hr className="row-menu-divider" />
          <button type="button" role="menuitem" className="row-menu-item danger" onClick={choose(onDelete)}>
            <span>{single ? "Delete" : `Delete ${ids.length} notes`}</span>
          </button>
        </>
      )}
    </Menu>
  );
}

interface SidebarProps {
  notes: Note[];
  groups: NoteGroup[];
  // Notes matching the search, or null while nothing is searched for.
  searchResults: Note[] | null;
  recentNotes: Note[];
  loaded: boolean;
  activeNoteId: string | null;
  query: string;
  theme: Theme;
  searchRef: Ref<HTMLInputElement>;
  searchShortcut: string;
  collapsedGroups: ReadonlySet<string>;
  collapsedSections: ReadonlySet<SidebarSection>;
  tests: TestSummary[] | null;
  testFolders: TestFolder[];
  papers: Paper[] | null;
  paperFolders: PaperFolder[];
  activePaperId: string | null;
  // Papers matching the search, beside the notes found.
  paperResults: Paper[] | null;
  papersUploading: number;
  papersNotice: PapersNotice | null;
  onOpenPaper: (paper: Paper) => void;
  onAddPapers: (files: File[], folderId: string | null) => void;
  onMovePaper: (paper: Paper, folderId: string | null) => Promise<void>;
  onDeletePaper: (paper: Paper) => void;
  onCreatePaperFolder: (name: string) => Promise<unknown>;
  onRenamePaperFolder: (id: string, name: string) => Promise<void>;
  onDeletePaperFolder: (folder: PaperFolder) => void;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  // Several notes at once, from a selection made with Shift+click or Ctrl+click.
  onOpenNotes: (ids: string[]) => void;
  onDeleteNotes: (ids: string[]) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onToggleTheme: () => void;
  onToggleGroup: (id: string, open?: boolean) => void;
  onToggleSection: (section: SidebarSection, open?: boolean) => void;
  onStartTest: (test: TestSummary) => void;
  onRenameTestFolder: (id: string, name: string) => Promise<void>;
  onDeleteTestFolder: (folder: TestFolder) => void;
  onCreateNoteIn: (groupId: string) => void;
  onCreateGroup: (name: string, parentId: string | null, section: Section) => Promise<unknown>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onMoveGroup: (id: string, parentId: string | null, section: Section) => Promise<void>;
  onDeleteGroup: (group: NoteGroup) => void;
  onPlaceNotes: (groupId: string | null, ids: string[]) => Promise<void>;
  onGenerateView: (group: NoteGroup) => void;
  onExportView: (group: NoteGroup) => void;
  // Given when the sidebar is shown as a drawer, which needs its own close button.
  onClose?: () => void;
}

const SECTION_TEXT = {
  notes: { title: "Notes", create: "New group", icon: "folderPlus" },
  works: { title: "Works", create: "New work", icon: "bookPlus" },
  skills: { title: SECTION_LABELS.skills, create: "New folder of agent skills", icon: "folderPlus" },
} as const;

// What a section's count counts.
const COUNTED = {
  notes: ["note", "notes"],
  works: ["page", "pages"],
  skills: ["skill", "skills"],
} as const;

function SidebarView({
  notes,
  groups,
  searchResults,
  recentNotes,
  loaded,
  activeNoteId,
  query,
  theme,
  searchRef,
  searchShortcut,
  collapsedGroups,
  collapsedSections,
  tests,
  testFolders,
  papers,
  paperFolders,
  activePaperId,
  paperResults,
  papersUploading,
  papersNotice,
  onOpenPaper,
  onAddPapers,
  onMovePaper,
  onDeletePaper,
  onCreatePaperFolder,
  onRenamePaperFolder,
  onDeletePaperFolder,
  onQueryChange,
  onSelect,
  onOpenNotes,
  onDeleteNotes,
  onCreate,
  onDelete,
  onToggleTheme,
  onToggleGroup,
  onToggleSection,
  onStartTest,
  onRenameTestFolder,
  onDeleteTestFolder,
  onCreateNoteIn,
  onCreateGroup,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
  onPlaceNotes,
  onGenerateView,
  onExportView,
  onClose,
}: SidebarProps) {
  const [creatingIn, setCreatingIn] = useState<Section | null>(null);
  const createRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const dragged = useRef<Dragged | null>(null);
  // Papers: the file picker, and which folder (if any) the picked PDFs go into.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickInto = useRef<string | null>(null);
  const newFolderRef = useRef<HTMLButtonElement | null>(null);
  const [creatingPaperFolder, setCreatingPaperFolder] = useState(false);
  const pickPapers = (folderId: string | null) => {
    pickInto.current = folderId;
    fileInputRef.current?.click();
  };

  // Notes picked together: Shift+click picks everything from the last note clicked (the anchor)
  // to this one, as the sidebar lists them; Ctrl+click adds or removes one.
  const { notify } = useDialogs();
  const shortcutDone = useCallback(
    (created: boolean, error: string | null) =>
      notify(
        created ? "Desktop icon added" : "Desktop icon not added",
        created ? "Argonaut is on your desktop now." : (error ?? "Windows didn't make the shortcut."),
      ),
    [notify],
  );
  const desktopShortcut = useDesktopShortcut(shortcutDone);
  const [selection, setSelection] = useState<{ ids: string[]; anchor: string | null }>({ ids: [], anchor: null });
  const [notesMenu, setNotesMenu] = useState<{ ids: string[]; at: { x: number; y: number }; moving: boolean } | null>(
    null,
  );
  const noteIds = useMemo(() => new Set(notes.map((note) => note.id)), [notes]);
  const order = useMemo(
    () =>
      visibleNoteOrder(
        notes,
        groups,
        SECTIONS.filter((section) => !collapsedSections.has(section)),
        collapsedGroups,
      ),
    [notes, groups, collapsedSections, collapsedGroups],
  );
  // Notes deleted meanwhile (here or in another window) drop out.
  const picked = useMemo(() => selection.ids.filter((id) => noteIds.has(id)), [selection.ids, noteIds]);
  const selected = useMemo(() => new Set(picked.length > 1 ? picked : []), [picked]);
  // In the order the sidebar shows them, so they keep it wherever they go.
  const listed = (ids: string[]) => {
    const wanted = new Set(ids);
    const shown = order.filter((id) => wanted.has(id));
    return [...shown, ...ids.filter((id) => !shown.includes(id))];
  };

  const clickNote = (id: string, how: { range: boolean; toggle: boolean }) => {
    if (how.range) {
      const anchor =
        selection.anchor && order.includes(selection.anchor)
          ? selection.anchor
          : activeNoteId && order.includes(activeNoteId)
            ? activeNoteId
            : id;
      const from = order.indexOf(anchor);
      const to = order.indexOf(id);
      const span = from < 0 || to < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelection({ ids: how.toggle ? [...new Set([...picked, ...span])] : span, anchor });
      return;
    }
    if (how.toggle) {
      // The note open in the editor counts as picked, so Ctrl+click adds a second one to it.
      const base = picked.length > 0 ? picked : activeNoteId && noteIds.has(activeNoteId) ? [activeNoteId] : [];
      setSelection({ ids: base.includes(id) ? base.filter((other) => other !== id) : [...base, id], anchor: id });
      return;
    }
    setSelection({ ids: [id], anchor: id });
    onSelect(id);
  };

  // A right-click on a picked note acts on all of them; on any other note, on that one alone.
  const noteMenu = (id: string, at: { x: number; y: number }) => {
    if (selected.has(id)) {
      setNotesMenu({ ids: listed(picked), at, moving: false });
    } else {
      setSelection({ ids: [id], anchor: id });
      setNotesMenu({ ids: [id], at, moving: false });
    }
  };

  const clearSelection = () => setSelection((current) => ({ ids: [], anchor: current.anchor }));

  // Into a group (or the top level of Notes), after the notes already there, in sidebar order.
  const moveNotes = (ids: string[], groupId: string | null) => {
    const moving = new Set(ids);
    const staying = notesDirectlyIn(notes, groups, groupId)
      .map((note) => note.id)
      .filter((id) => !moving.has(id));
    if (groupId) onToggleGroup(groupId, true);
    onPlaceNotes(groupId, [...staying, ...ids]).catch((cause: unknown) =>
      notify(ids.length === 1 ? "Note not moved" : "Notes not moved", errorMessage(cause)),
    );
  };

  const dragIds = (id: string) => (selected.has(id) ? listed(picked) : [id]);

  const onNavKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && selected.size > 0 && !notesMenu) {
      event.stopPropagation();
      clearSelection();
    }
  };
  // "Lately" earns its space only when it isn't just the whole list again.
  const showRecent = searchResults === null && notes.length > recentNotes.length;

  const counts = { notes: 0, works: 0, skills: 0 };
  for (const note of notes) counts[sectionOf(groups, note.groupId)] += 1;

  const heading = (section: Section) => {
    const text = SECTION_TEXT[section];
    const open = !collapsedSections.has(section);
    return (
      <div className="nav-heading nav-section-heading">
        <button
          type="button"
          className="nav-section-toggle"
          aria-expanded={open}
          onClick={() => onToggleSection(section)}
        >
          <span className="nav-group-chevron">
            <Icon name="chevron" size={14} />
          </span>
          {text.title}
        </button>
        <span className="nav-heading-tools">
          {loaded && counts[section] > 0 && (
            <span className="nav-count">
              {counts[section]}
              <span className="visually-hidden">
                {` ${COUNTED[section][counts[section] === 1 ? 0 : 1]}`}
              </span>
            </span>
          )}
          <button
            ref={(element) => {
              createRefs.current[section] = element;
            }}
            type="button"
            className="icon-btn nav-heading-btn"
            aria-label={text.create}
            title={text.create}
            onClick={() => {
              onToggleSection(section, true);
              setCreatingIn(section);
            }}
          >
            <Icon name={text.icon} size={16} />
          </button>
        </span>
      </div>
    );
  };

  const tree = (section: Section) => (
    <NoteTree
      section={section}
      heading={heading(section)}
      open={!collapsedSections.has(section)}
      notes={notes}
      groups={groups}
      activeNoteId={activeNoteId}
      collapsed={collapsedGroups}
      dragged={dragged}
      creatingTopLevel={creatingIn === section}
      onCreatingTopLevelDone={(fromKeyboard) => {
        setCreatingIn(null);
        if (fromKeyboard) createRefs.current[section]?.focus();
      }}
      onToggleGroup={onToggleGroup}
      selected={selected}
      onNoteClick={clickNote}
      onNoteMenu={noteMenu}
      dragIds={dragIds}
      onDelete={onDelete}
      onCreateNoteIn={onCreateNoteIn}
      onCreateGroup={onCreateGroup}
      onRenameGroup={onRenameGroup}
      onMoveGroup={onMoveGroup}
      onDeleteGroup={onDeleteGroup}
      onPlaceNotes={onPlaceNotes}
      onGenerateView={onGenerateView}
      onExportView={onExportView}
    />
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <ArgonautMark size={28} />
        <span className="brand-name">Argonaut</span>
        {onClose && (
          <button type="button" className="icon-btn sidebar-close" aria-label="Close navigation" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>

      <div className="sidebar-actions">
        <button type="button" className="new-note-btn" onClick={onCreate}>
          <Icon name="plus" />
          New note
        </button>
      </div>

      <div className="sidebar-search">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          type="search"
          className="search-input"
          placeholder="Search notes"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onQueryChange("");
              event.currentTarget.blur();
            }
          }}
          aria-label="Search notes, pages and groups"
        />
        <kbd className="kbd-hint">{searchShortcut}</kbd>
      </div>

      <nav className="sidebar-nav" aria-label="Notes, works, papers, tests and agent skills" onKeyDown={onNavKeyDown}>
        {searchResults !== null ? (
          <>
            <div className="nav-heading">
              <span>Found</span>
              <span className="nav-count">{searchResults.length + (paperResults?.length ?? 0)}</span>
            </div>
            {searchResults.length === 0 && (paperResults?.length ?? 0) === 0 ? (
              <p className="empty-hint">No notes or papers match.</p>
            ) : (
              <ul className="nav-list">
                {searchResults.map((note) => {
                  const active = note.id === activeNoteId;
                  const where = groupLabel(groups, note.groupId);
                  const inWorks = sectionOf(groups, note.groupId) === "works";
                  return (
                    <li key={note.id} className={`nav-item ${active ? "nav-item-active" : ""}`}>
                      <button
                        type="button"
                        className="nav-item-select nav-item-found"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onSelect(note.id)}
                      >
                        <span className="nav-item-title">{note.title || "Untitled"}</span>
                        {where && (
                          <span className="nav-item-path">
                            <Icon name={inWorks ? "book" : "folder"} size={13} />
                            {where}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {(paperResults ?? []).map((paper) => {
                  const active = paper.id === activePaperId;
                  return (
                    <li key={paper.id} className={`nav-item ${active ? "nav-item-active" : ""}`}>
                      <button
                        type="button"
                        className="nav-item-select nav-item-found"
                        aria-current={active ? "page" : undefined}
                        title={describePaper(paper)}
                        onClick={() => onOpenPaper(paper)}
                      >
                        <span className="nav-item-title">{paper.title}</span>
                        <span className="nav-item-path">
                          <Icon name="paper" size={13} />
                          {paper.authors ? `Paper · ${paper.authors}` : "Paper"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            {tree("notes")}
            {loaded && notes.length === 0 && <p className="empty-hint">No notes yet.</p>}
            {tree("works")}
            <PaperTree
              heading={
                <div className="nav-heading nav-section-heading">
                  <button
                    type="button"
                    className="nav-section-toggle"
                    aria-expanded={!collapsedSections.has("papers")}
                    onClick={() => onToggleSection("papers")}
                  >
                    <span className="nav-group-chevron">
                      <Icon name="chevron" size={14} />
                    </span>
                    Papers
                  </button>
                  <span className="nav-heading-tools">
                    {papers && papers.length > 0 && (
                      <span className="nav-count">
                        {papers.length}
                        <span className="visually-hidden">{papers.length === 1 ? " paper" : " papers"}</span>
                      </span>
                    )}
                    <button
                      ref={newFolderRef}
                      type="button"
                      className="icon-btn nav-heading-btn"
                      aria-label="New folder of papers"
                      title="New folder"
                      onClick={() => {
                        onToggleSection("papers", true);
                        setCreatingPaperFolder(true);
                      }}
                    >
                      <Icon name="folderPlus" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn nav-heading-btn"
                      aria-label="Add papers (PDF files)"
                      title="Add papers (PDF)"
                      onClick={() => {
                        onToggleSection("papers", true);
                        pickPapers(null);
                      }}
                    >
                      <Icon name="paperPlus" size={16} />
                    </button>
                  </span>
                </div>
              }
              open={!collapsedSections.has("papers")}
              papers={papers}
              folders={paperFolders}
              activePaperId={activePaperId}
              collapsed={collapsedGroups}
              uploading={papersUploading}
              notice={papersNotice}
              creatingFolder={creatingPaperFolder}
              onCreatingFolderDone={(fromKeyboard) => {
                setCreatingPaperFolder(false);
                if (fromKeyboard) newFolderRef.current?.focus();
              }}
              onPickFiles={pickPapers}
              onToggleFolder={onToggleGroup}
              onOpen={onOpenPaper}
              onAddFiles={onAddPapers}
              onMove={onMovePaper}
              onDelete={onDeletePaper}
              onCreateFolder={onCreatePaperFolder}
              onRenameFolder={onRenamePaperFolder}
              onDeleteFolder={onDeletePaperFolder}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length > 0) onAddPapers(files, pickInto.current);
              }}
            />
            <TestTree
              heading={
                <div className="nav-heading nav-section-heading">
                  <button
                    type="button"
                    className="nav-section-toggle"
                    aria-expanded={!collapsedSections.has("tests")}
                    onClick={() => onToggleSection("tests")}
                  >
                    <span className="nav-group-chevron">
                      <Icon name="chevron" size={14} />
                    </span>
                    Tests
                  </button>
                  {tests && tests.length > 0 && (
                    <span className="nav-count">
                      {tests.length}
                      <span className="visually-hidden">{tests.length === 1 ? " test" : " tests"}</span>
                    </span>
                  )}
                </div>
              }
              open={!collapsedSections.has("tests")}
              tests={tests}
              folders={testFolders}
              collapsed={collapsedGroups}
              onToggleFolder={onToggleGroup}
              onStart={onStartTest}
              onRenameFolder={onRenameTestFolder}
              onDeleteFolder={onDeleteTestFolder}
            />
            {tree("skills")}
          </>
        )}
        {showRecent && (
          <>
            <div className="nav-heading">
              <span>Lately</span>
            </div>
            <ul className="nav-list">
              {recentNotes.map((note) => (
                <li key={note.id} className="nav-item">
                  <button type="button" className="nav-item-select nav-item-recent" onClick={() => onSelect(note.id)}>
                    {note.title || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {notesMenu &&
          createPortal(
            <NotesMenu
              notes={notes}
              groups={groups}
              ids={notesMenu.ids}
              at={notesMenu.at}
              startMoving={notesMenu.moving}
              onOpen={() => onOpenNotes(notesMenu.ids)}
              onMove={(groupId) => moveNotes(notesMenu.ids, groupId)}
              onDelete={() => onDeleteNotes(notesMenu.ids)}
              onClose={() => setNotesMenu(null)}
            />,
            document.body,
          )}
      </nav>

      {selected.size > 0 && (
        <div className="selection-bar" role="group" aria-label="Selected notes">
          <span className="selection-count" role="status">
            {selected.size} selected
          </span>
          <button type="button" className="ghost-btn" onClick={() => onOpenNotes(listed(picked))}>
            Open
          </button>
          <button
            type="button"
            className="ghost-btn"
            aria-haspopup="menu"
            aria-expanded={notesMenu?.moving ?? false}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setNotesMenu({ ids: listed(picked), at: { x: rect.left, y: rect.top - 8 }, moving: true });
            }}
          >
            Move to…
          </button>
          <button type="button" className="ghost-btn danger" onClick={() => onDeleteNotes(listed(picked))}>
            Delete
          </button>
          <button
            type="button"
            className="icon-btn selection-clear"
            aria-label="Clear the selection (Esc)"
            title="Clear the selection (Esc)"
            onClick={clearSelection}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <footer className="sidebar-footer">
        <button type="button" className="ghost-btn" onClick={onToggleTheme}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        {/* Only in the Argonaut window, and only while there's no icon on the desktop. */}
        {desktopShortcut.canCreate && (
          <button
            type="button"
            className="ghost-btn"
            onClick={desktopShortcut.create}
            disabled={desktopShortcut.creating}
            title="Put an Argonaut icon on the desktop"
          >
            Add desktop icon
          </button>
        )}
      </footer>
    </aside>
  );
}

// Typing in a note changes none of what it shows, so it is only redrawn when its props change.
export const Sidebar = memo(SidebarView);
