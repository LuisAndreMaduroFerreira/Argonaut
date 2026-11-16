import type { Note, NoteGroup, Section } from "../types";

// Each section's name in the sidebar and in pickers.
export const SECTION_LABELS: Record<Section, string> = { notes: "Notes", works: "Works", skills: "Agent Skills" };

// Shown between the names in a group's path: "French › Verbs".
export const PATH_SEPARATOR = " › ";

// "Chapter 2" before "Chapter 10": numbers inside names compare as numbers.
const byName = (a: NoteGroup, b: NoteGroup) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

// A top-level group's section; copies cached before sections existed count as Notes.
const sectionOfTop = (group: NoteGroup): Section => group.section ?? "notes";

// The groups directly inside a group, or at the top level of a section.
export function childGroups(groups: NoteGroup[], parentId: string | null, section: Section = "notes"): NoteGroup[] {
  return groups
    .filter((group) => group.parentId === parentId && (parentId !== null || sectionOfTop(group) === section))
    .sort(byName);
}

// The names from the top level down to the group, or [] for an unknown group.
export function groupPath(groups: NoteGroup[], id: string | null): string[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const names: string[] = [];
  const seen = new Set<string>();
  for (let group = id ? byId.get(id) : undefined; group && !seen.has(group.id); ) {
    seen.add(group.id);
    names.unshift(group.name);
    group = group.parentId ? byId.get(group.parentId) : undefined;
  }
  return names;
}

export function groupLabel(groups: NoteGroup[], id: string | null): string {
  return groupPath(groups, id).join(PATH_SEPARATOR);
}

// The section a group, or a note's group, is in. A note in no group is in Notes.
export function sectionOf(groups: NoteGroup[], id: string | null): Section {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  let group = id ? byId.get(id) : undefined;
  while (group?.parentId && !seen.has(group.id)) {
    seen.add(group.id);
    group = byId.get(group.parentId);
  }
  return group ? sectionOfTop(group) : "notes";
}

// The group and every group inside it, at any depth.
export function groupAndBelow(groups: NoteGroup[], id: string): Set<string> {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const group of groups) {
      if (group.parentId && found.has(group.parentId) && !found.has(group.id)) {
        found.add(group.id);
        grew = true;
      }
    }
  }
  return found;
}

// Every group of a section in sidebar order, each with its depth and full path: for pickers.
export function flattenGroups(
  groups: NoteGroup[],
  section: Section = "notes",
): { group: NoteGroup; depth: number; label: string }[] {
  const rows: { group: NoteGroup; depth: number; label: string }[] = [];
  const visit = (parentId: string | null, depth: number, prefix: string[]) => {
    for (const group of childGroups(groups, parentId, section)) {
      const path = [...prefix, group.name];
      rows.push({ group, depth, label: path.join(PATH_SEPARATOR) });
      visit(group.id, depth + 1, path);
    }
  };
  visit(null, 0, []);
  return rows;
}

// A note whose group has gone (deleted in another window) counts as in no group.
export function effectiveGroupId(note: Note, groups: NoteGroup[]): string | null {
  return note.groupId && groups.some((group) => group.id === note.groupId) ? note.groupId : null;
}

// Notes in the order they were dragged into; ones without a place yet come last, newest first.
export function inOrder(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY) ||
      b.updatedAt - a.updatedAt,
  );
}

// The notes directly in a group (or at the top level of Notes, for null), in order.
export function notesDirectlyIn(notes: Note[], groups: NoteGroup[], id: string | null): Note[] {
  return inOrder(notes.filter((note) => effectiveGroupId(note, groups) === id));
}

// The notes in a group and all its subgroups.
export function notesInGroup(notes: Note[], groups: NoteGroup[], id: string): Note[] {
  const ids = groupAndBelow(groups, id);
  return notes.filter((note) => note.groupId !== null && ids.has(note.groupId));
}

// The notes the sidebar lists, top to bottom: each open section in turn, a group's subgroups
// before its own notes, skipping what closed groups hide. Shift+click selects a stretch of it.
export function visibleNoteOrder(
  notes: Note[],
  groups: NoteGroup[],
  openSections: Section[],
  collapsed: ReadonlySet<string>,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (groupId: string) => {
    if (seen.has(groupId) || collapsed.has(groupId)) return;
    seen.add(groupId);
    for (const child of childGroups(groups, groupId)) visit(child.id);
    for (const note of notesDirectlyIn(notes, groups, groupId)) order.push(note.id);
  };
  for (const section of openSections) {
    for (const group of childGroups(groups, null, section)) visit(group.id);
    if (section === "notes") for (const note of notesDirectlyIn(notes, groups, null)) order.push(note.id);
  }
  return order;
}

// Every note under a group in the order the sidebar shows them: each subgroup's notes in
// turn, then the group's own. This is a work's reading order.
export function notesInReadingOrder(notes: Note[], groups: NoteGroup[], id: string): Note[] {
  const seen = new Set<string>();
  const visit = (groupId: string): Note[] => {
    if (seen.has(groupId)) return [];
    seen.add(groupId);
    return [
      ...childGroups(groups, groupId).flatMap((child) => visit(child.id)),
      ...notesDirectlyIn(notes, groups, groupId),
    ];
  };
  return visit(id);
}
