import { useCallback, useEffect, useMemo } from "react";
import { effectiveGroupId, sectionOf } from "../lib/groups";
import type { Note, NoteGroup, SidebarSection } from "../types";
import { useAppState } from "./useAppState";
import { useLatest } from "./useLatest";

// Which of the sidebar's sections, groups and folders are closed. Remembered with the other
// preferences, so every window shows the same; everything starts open.
export function useSidebarState(activeNote: Note | null, groups: NoteGroup[]) {
  const { preferences, patch } = useAppState();

  const collapsedSections = useMemo(() => new Set(preferences.collapsedSections), [preferences.collapsedSections]);
  const toggleSection = useCallback(
    (section: SidebarSection, open?: boolean) => {
      const isOpen = !collapsedSections.has(section);
      if (open === isOpen) return;
      patch("preferences", {
        collapsedSections: isOpen
          ? [...preferences.collapsedSections, section]
          : preferences.collapsedSections.filter((other) => other !== section),
      });
    },
    [collapsedSections, patch, preferences.collapsedSections],
  );

  const collapsedGroups = useMemo(() => new Set(preferences.collapsedGroups), [preferences.collapsedGroups]);
  const toggleGroup = useCallback(
    (id: string, open?: boolean) => {
      const isOpen = !collapsedGroups.has(id);
      if (open === isOpen) return;
      patch("preferences", {
        collapsedGroups: isOpen
          ? [...preferences.collapsedGroups, id]
          : preferences.collapsedGroups.filter((other) => other !== id),
      });
    },
    [collapsedGroups, patch, preferences.collapsedGroups],
  );

  // Opening a note inside a closed group opens the groups around it, and its section, so it
  // shows in the list. Only when a different note comes up or it changes group: the effect
  // reads what's closed through a ref, so closing the group around the open note doesn't run
  // it again and reopen the group at once.
  const activeNoteId = activeNote?.id ?? null;
  const activeGroupId = activeNote ? effectiveGroupId(activeNote, groups) : null;
  const closed = useLatest({ collapsedGroups, collapsedSections, stored: preferences.collapsedGroups, patch, toggleSection });
  useEffect(() => {
    if (activeNoteId === null) return;
    const now = closed.current;
    const byId = new Map(groups.map((group) => [group.id, group]));
    const around: string[] = [];
    for (let id = activeGroupId; id; id = byId.get(id)?.parentId ?? null) {
      if (now.collapsedGroups.has(id)) around.push(id);
    }
    if (around.length > 0) {
      now.patch("preferences", { collapsedGroups: now.stored.filter((id) => !around.includes(id)) });
    }
    const section = sectionOf(groups, activeGroupId);
    if (now.collapsedSections.has(section)) now.toggleSection(section, true);
  }, [activeNoteId, activeGroupId, groups, closed]);

  return { collapsedGroups, collapsedSections, toggleGroup, toggleSection };
}
