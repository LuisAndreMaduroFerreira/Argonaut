import { useMemo, useState, type DragEvent, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { Note, NoteGroup, Section } from "../types";
import { SECTION_LABELS, childGroups, effectiveGroupId, flattenGroups, groupAndBelow, inOrder, sectionOf } from "../lib/groups";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import { NameBox } from "./NameBox";
import {
  depthStyle,
  focusSoon,
  FolderRow,
  MenuItem,
  MoreButton,
  pointerOf,
  underRow,
  useTreeError,
  type Point,
} from "./treeParts";

// One sidebar section's notes as groups and subgroups: Notes; Works, where each top-level
// group is a book and its notes are pages; or Agent Skills, folders of instructions for AI
// agents, a note each. Notes move by dragging: onto a group to file them
// last there, or above or below another note to put them in that place; groups move onto
// another group, or onto empty space for the top level. The ⋯ menu (or a right-click on a
// group), Details › Group and Alt+↑/↓ do the same from the keyboard. Shift+click and
// Ctrl+click pick several notes, which then drag, move and delete together.

interface NoteTreeProps {
  section: Section;
  // The section's heading, drawn inside the tree so it also takes drops for the top level.
  heading: ReactNode;
  // The section itself can be closed, leaving only its heading.
  open: boolean;
  notes: Note[];
  groups: NoteGroup[];
  activeNoteId: string | null;
  collapsed: ReadonlySet<string>;
  // What's being dragged, shared by both sections' trees so a note can go from one to the other.
  dragged: MutableRefObject<Dragged | null>;
  // A name box for a new top-level group (or work), opened from the heading.
  creatingTopLevel: boolean;
  onCreatingTopLevelDone: (fromKeyboard: boolean) => void;
  onToggleGroup: (id: string, open?: boolean) => void;
  // The notes picked together, when there are two or more.
  selected: ReadonlySet<string>;
  // A click on a note: Shift picks everything from the last note clicked; Ctrl (or ⌘) adds or
  // removes one; a plain click opens it.
  onNoteClick: (id: string, how: { range: boolean; toggle: boolean }) => void;
  // A right-click (or the context-menu key) on a note.
  onNoteMenu: (id: string, at: { x: number; y: number }) => void;
  // What dragging a note carries: the whole selection when the note is part of it.
  dragIds: (id: string) => string[];
  onDelete: (id: string) => void;
  onCreateNoteIn: (groupId: string) => void;
  onCreateGroup: (name: string, parentId: string | null, section: Section) => Promise<unknown>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onMoveGroup: (id: string, parentId: string | null, section: Section) => Promise<void>;
  onDeleteGroup: (group: NoteGroup) => void;
  onPlaceNotes: (groupId: string | null, ids: string[]) => Promise<void>;
  onGenerateView: (group: NoteGroup) => void;
  onExportView: (group: NoteGroup) => void;
}

export type Dragged = { kind: "notes"; ids: string[] } | { kind: "group"; id: string };

// Where a drop lands: into a group (last, for a note), or beside a note in its group.
type Target =
  | { kind: "into"; groupId: string | null }
  | { kind: "beside"; noteId: string; groupId: string | null; after: boolean };

// Only Argonaut's own drags carry this, so a dragged note can never drop its id into the text.
const DRAG_TYPE = "application/x-argonaut-item";

interface GroupMenuProps {
  group: NoteGroup;
  groups: NoteGroup[];
  section: Section;
  // Where a right-click opened it; without it, the menu hangs under its row.
  at: Point | null;
  onGenerateView: () => void;
  onExportView: () => void;
  onRename: () => void;
  onNewSubgroup: () => void;
  onMove: (parentId: string | null, section: Section) => void;
  onDelete: () => void;
  // true when the menu should hand focus back to where it came from (Escape, or a choice made).
  onClose: (returnFocus: boolean) => void;
}

function GroupMenu({
  group,
  groups,
  section,
  at,
  onGenerateView,
  onExportView,
  onRename,
  onNewSubgroup,
  onMove,
  onDelete,
  onClose,
}: GroupMenuProps) {
  const [moving, setMoving] = useState(false);
  const inWorks = section === "works";
  const isWork = inWorks && group.parentId === null;

  // Anywhere except inside the group itself, and not where it already is.
  const destinations = useMemo(() => {
    const inside = groupAndBelow(groups, group.id);
    const within = (target: Section) =>
      flattenGroups(groups, target)
        .filter((row) => !inside.has(row.group.id) && row.group.id !== group.parentId)
        .map((row) => ({ id: row.group.id as string | null, label: row.label, section: target }));
    const top = (target: Section) =>
      group.parentId === null && section === target
        ? []
        : [{ id: null, label: target === "works" ? "Top level, as a work" : "Top level", section: target }];
    return [
      { heading: "Notes", items: [...top("notes"), ...within("notes")] },
      { heading: "Works", items: [...top("works"), ...within("works")] },
      { heading: SECTION_LABELS.skills, items: [...top("skills"), ...within("skills")] },
    ].filter((part) => part.items.length > 0);
  }, [groups, group, section]);

  const choose = (action: () => void) => () => {
    onClose(true);
    action();
  };

  return (
    <Menu
      label={`${group.name}: actions`}
      at={at}
      focusKey={moving}
      onEscape={() => (moving ? setMoving(false) : onClose(true))}
      onDismiss={() => onClose(false)}
    >
      {moving ? (
        <>
          <p className="row-menu-heading">Move “{group.name}” to</p>
          {destinations.map((part) => (
            <div key={part.heading} role="group" aria-label={part.heading}>
              <p className="row-menu-subheading">{part.heading}</p>
              {part.items.map((destination) => (
                <MenuItem
                  key={`${destination.section}-${destination.id ?? "top"}`}
                  onClick={choose(() => onMove(destination.id, destination.section))}
                >
                  <Icon name={destination.id === null ? "menu" : "folder"} size={16} />
                  <span>{destination.label}</span>
                </MenuItem>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          {inWorks && (
            <>
              <MenuItem onClick={choose(onGenerateView)}>
                <Icon name="book" size={16} />
                <span>Generate current final view</span>
              </MenuItem>
              <MenuItem onClick={choose(onExportView)}>
                <Icon name="download" size={16} />
                <span>Export final view (.md)</span>
              </MenuItem>
              <hr className="row-menu-divider" />
            </>
          )}
          <MenuItem onClick={() => setMoving(true)} disabled={destinations.length === 0}>
            Move to…
          </MenuItem>
          <MenuItem onClick={choose(onNewSubgroup)}>{section === "notes" ? "New subgroup" : "New subfolder"}</MenuItem>
          <MenuItem onClick={choose(onRename)}>Rename</MenuItem>
          <MenuItem danger onClick={choose(onDelete)}>
            {isWork ? "Delete work" : section === "notes" ? "Delete group" : "Delete folder"}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

export function NoteTree({
  section,
  heading,
  open: sectionOpen,
  notes,
  groups,
  activeNoteId,
  collapsed,
  dragged,
  creatingTopLevel,
  onCreatingTopLevelDone,
  onToggleGroup,
  selected,
  onNoteClick,
  onNoteMenu,
  dragIds,
  onDelete,
  onCreateNoteIn,
  onCreateGroup,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
  onPlaceNotes,
  onGenerateView,
  onExportView,
}: NoteTreeProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ groupId: string; at: Point | null } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Errors from a drop or a menu choice, shown above the tree for a few seconds.
  const { error, attempt } = useTreeError();
  const inWorks = section === "works";
  const inSkills = section === "skills";
  // What the section calls its folders and its notes.
  const folderWord = section === "notes" ? "group" : "folder";
  const itemWords = inWorks ? (["page", "pages"] as const) : inSkills ? (["skill", "skills"] as const) : (["note", "notes"] as const);

  const { byGroup, counts } = useMemo(() => {
    const byGroup = new Map<string | null, Note[]>();
    const counts = new Map<string, number>();
    const parentOf = new Map(groups.map((group) => [group.id, group.parentId]));
    for (const note of notes) {
      const groupId = effectiveGroupId(note, groups);
      byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), note]);
      for (let id = groupId; id; id = parentOf.get(id) ?? null) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [groupId, list] of byGroup) byGroup.set(groupId, inOrder(list));
    return { byGroup, counts };
  }, [notes, groups]);

  // After a name box closes from the keyboard, focus goes back to the group it was about.
  const focusGroup = (groupId: string) => (fromKeyboard: boolean) => {
    if (fromKeyboard) focusSoon(`group-toggle-${groupId}`);
  };

  // A group's notes in order, less the ones being moved.
  const siblingIds = (groupId: string | null, without: ReadonlySet<string>) =>
    (byGroup.get(groupId) ?? []).map((note) => note.id).filter((id) => !without.has(id));

  const canDrop = (target: Target): boolean => {
    const item = dragged.current;
    if (!item) return false;
    if (item.kind === "notes") {
      if (target.kind === "beside") return !item.ids.includes(target.noteId);
      // Pages live inside works and skills inside folders: only Notes holds notes at its top level.
      return target.groupId !== null || section === "notes";
    }
    const group = groups.find((candidate) => candidate.id === item.id);
    if (!group) return false;
    const into = target.groupId;
    if (into === null) return group.parentId !== null || sectionOf(groups, group.id) !== section;
    return into !== group.parentId && !groupAndBelow(groups, group.id).has(into);
  };

  const keyOf = (target: Target) =>
    target.kind === "beside" ? `${target.after ? "after" : "before"}:${target.noteId}` : (target.groupId ?? "top");

  const startDrag = (event: DragEvent, item: Dragged) => {
    event.stopPropagation();
    dragged.current = item;
    setMenu(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, item.kind === "notes" ? item.ids.join(",") : item.id);
  };

  const endDrag = () => {
    dragged.current = null;
    setDropKey(null);
  };

  const dragOver = (event: DragEvent, target: Target) => {
    if (!dragged.current) return;
    event.stopPropagation();
    if (!canDrop(target)) {
      setDropKey(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropKey(keyOf(target));
  };

  const drop = (event: DragEvent, target: Target) => {
    const item = dragged.current;
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    const allowed = canDrop(target);
    endDrag();
    if (!allowed) return;
    if (item.kind === "group") {
      if (target.groupId) onToggleGroup(target.groupId, true);
      attempt(() => onMoveGroup(item.id, target.groupId, section));
      return;
    }
    // The dragged notes keep their order, together: last in a group, or at the drop line.
    const moving = new Set(item.ids);
    const ids = siblingIds(target.groupId, moving);
    if (target.kind === "into") {
      if (target.groupId) onToggleGroup(target.groupId, true);
      ids.push(...item.ids);
    } else {
      ids.splice(ids.indexOf(target.noteId) + (target.after ? 1 : 0), 0, ...item.ids);
    }
    attempt(() => onPlaceNotes(target.groupId, ids));
  };

  // A note's own row decides by the pointer: its upper half puts the dragged note above it.
  const besideTarget = (event: DragEvent, note: Note, home: string | null): Target => {
    if (dragged.current?.kind === "group") return { kind: "into", groupId: home };
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { kind: "beside", noteId: note.id, groupId: home, after: event.clientY > rect.top + rect.height / 2 };
  };

  // Alt+↑ and Alt+↓ move the focused note up or down among its neighbours.
  const nudge = (event: KeyboardEvent<HTMLButtonElement>, note: Note, home: string | null) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const ids = (byGroup.get(home) ?? []).map((sibling) => sibling.id);
    const from = ids.indexOf(note.id);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, note.id);
    attempt(() => onPlaceNotes(home, ids));
  };

  const closeMenu = (groupId: string, fromPointer: boolean) => (returnFocus: boolean) => {
    setMenu(null);
    if (returnFocus) {
      document.getElementById(fromPointer ? `group-toggle-${groupId}` : `group-more-${groupId}`)?.focus();
    }
  };

  const renderNote = (note: Note, depth: number) => {
    const active = note.id === activeNoteId;
    const picked = selected.has(note.id);
    const title = note.title || "Untitled";
    const home = effectiveGroupId(note, groups);
    const marker =
      dropKey === `before:${note.id}` ? "drop-before" : dropKey === `after:${note.id}` ? "drop-after" : "";
    return (
      <li
        key={note.id}
        className={`nav-item ${active ? "nav-item-active" : ""} ${picked ? "nav-item-selected" : ""} ${marker}`}
        style={depthStyle(depth)}
        draggable
        onDragStart={(event) => startDrag(event, { kind: "notes", ids: dragIds(note.id) })}
        onDragEnd={endDrag}
        onDragOver={(event) => dragOver(event, besideTarget(event, note, home))}
        onDrop={(event) => drop(event, besideTarget(event, note, home))}
        onContextMenu={(event) => {
          event.preventDefault();
          onNoteMenu(note.id, pointerOf(event) ?? underRow(event.currentTarget));
        }}
      >
        <button
          type="button"
          className="nav-item-select"
          aria-current={active ? "page" : undefined}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+Enter Control+Enter"
          onClick={(event) => onNoteClick(note.id, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey })}
          onKeyDown={(event) => {
            // Shift+Enter and Ctrl+Enter pick notes from the keyboard, like Shift+click and Ctrl+click.
            if (event.key === "Enter" && (event.shiftKey || event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onNoteClick(note.id, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
              return;
            }
            nudge(event, note, home);
          }}
        >
          {title}
          {picked && <span className="visually-hidden">, selected</span>}
        </button>
        <button
          type="button"
          className="icon-btn nav-item-delete"
          aria-label={`Delete ${title}`}
          title="Delete"
          onClick={() => onDelete(note.id)}
        >
          <Icon name="close" size={16} />
        </button>
      </li>
    );
  };

  const renderGroup = (group: NoteGroup, depth: number) => {
    const open = !collapsed.has(group.id);
    const subgroups = childGroups(groups, group.id);
    const groupNotes = byGroup.get(group.id) ?? [];
    const count = counts.get(group.id) ?? 0;
    const isWork = inWorks && group.parentId === null;
    const into: Target = { kind: "into", groupId: group.id };
    return (
      <li key={group.id} className="nav-group">
        <FolderRow
          toggleId={`group-toggle-${group.id}`}
          name={group.name}
          icon={isWork ? "book" : "folder"}
          depth={depth}
          open={open}
          count={count}
          countLabel={itemWords[count === 1 ? 0 : 1]}
          renaming={renaming === group.id}
          onRename={(name) => onRenameGroup(group.id, name)}
          onRenameDone={() => setRenaming(null)}
          onToggle={() => onToggleGroup(group.id)}
          onContextMenu={(event) => setMenu({ groupId: group.id, at: pointerOf(event) })}
          className={dropKey === group.id ? "drop-target" : ""}
          rowProps={{
            draggable: renaming !== group.id,
            onDragStart: (event) => startDrag(event, { kind: "group", id: group.id }),
            onDragEnd: endDrag,
            onDragOver: (event) => dragOver(event, into),
            onDrop: (event) => drop(event, into),
          }}
          actions={
            <>
              <button
                type="button"
                className="icon-btn nav-row-action"
                aria-label={`New ${itemWords[0]} in ${group.name}`}
                title={inWorks ? "New page here" : `New ${itemWords[0]} in this ${folderWord}`}
                onClick={() => {
                  onToggleGroup(group.id, true);
                  onCreateNoteIn(group.id);
                }}
              >
                <Icon name="plus" size={16} />
              </button>
              <MoreButton
                id={`group-more-${group.id}`}
                name={group.name}
                title={inWorks ? "Final view, export, move, rename, delete" : inSkills ? "Rename, move, subfolder, delete" : "Rename, move, subgroup, delete"}
                expanded={menu?.groupId === group.id}
                onClick={() => setMenu(menu?.groupId === group.id ? null : { groupId: group.id, at: null })}
              />
            </>
          }
          menu={
            menu?.groupId === group.id && (
            <GroupMenu
              group={group}
              groups={groups}
              section={section}
              at={menu.at}
              onGenerateView={() => onGenerateView(group)}
              onExportView={() => onExportView(group)}
              onRename={() => setRenaming(group.id)}
              onNewSubgroup={() => {
                onToggleGroup(group.id, true);
                setCreatingIn(group.id);
              }}
              onMove={(parentId, target) => attempt(() => onMoveGroup(group.id, parentId, target))}
              onDelete={() => onDeleteGroup(group)}
              onClose={closeMenu(group.id, menu.at !== null)}
            />
            )
          }
        />
        {open && (
          <ul className="nav-list">
            {creatingIn === group.id && (
              <li>
                <NameBox
                  depth={depth + 1}
                  label={`Name of the new ${folderWord} in ${group.name}`}
                  onSubmit={(name) => onCreateGroup(name, group.id, section)}
                  onDone={(fromKeyboard) => {
                    setCreatingIn(null);
                    focusGroup(group.id)(fromKeyboard);
                  }}
                />
              </li>
            )}
            {subgroups.map((subgroup) => renderGroup(subgroup, depth + 1))}
            {groupNotes.map((note) => renderNote(note, depth + 1))}
            {subgroups.length === 0 && groupNotes.length === 0 && creatingIn !== group.id && (
              <li className="nav-empty" style={depthStyle(depth + 1)}>
                {inWorks ? "No pages yet: + adds one" : `Empty: drag ${itemWords[1]} here, or use +`}
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const topGroups = childGroups(groups, null, section);
  const topNotes = section === "notes" ? (byGroup.get(null) ?? []) : [];
  const top: Target = { kind: "into", groupId: null };

  return (
    <div
      className={`note-tree ${dropKey === "top" ? "drop-top" : ""}`}
      onDragOver={(event) => dragOver(event, top)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropKey(null);
      }}
      onDrop={(event) => drop(event, top)}
    >
      {heading}
      {sectionOpen && (
        <>
          {error && (
            <p className="nav-error" role="alert">
              {error}
            </p>
          )}
          <ul className="nav-list">
            {creatingTopLevel && (
              <li>
                <NameBox
                  depth={0}
                  label={inWorks ? "Name of the new work" : `Name of the new ${folderWord}`}
                  onSubmit={(name) => onCreateGroup(name, null, section)}
                  onDone={onCreatingTopLevelDone}
                />
              </li>
            )}
            {topGroups.map((group) => renderGroup(group, 0))}
            {topNotes.map((note) => renderNote(note, 0))}
          </ul>
          {inWorks && topGroups.length === 0 && !creatingTopLevel && (
            <p className="empty-hint">No works yet. The book button beside Works starts one.</p>
          )}
          {inSkills && topGroups.length === 0 && !creatingTopLevel && (
            <p className="empty-hint">No agent skills yet. The folder button beside Agent Skills starts a folder.</p>
          )}
        </>
      )}
    </div>
  );
}
