import { useCallback, useEffect, useMemo } from "react";
import { parseTabKey, tabKey, type Tab } from "../../shared/tabs";
import type { Cadence, Note, Paper } from "../types";
import { useAppState } from "./useAppState";

// The tabs the workspace remembers: every kind except a work's final view, which lives only
// as long as its tab does.
export type WorkspaceTab = Exclude<Tab, { kind: "view" }>;

const noteTab = (id: string): WorkspaceTab => ({ kind: "note", id });
const paperTab = (id: string): WorkspaceTab => ({ kind: "paper", id });

// `added` put right after `anchor` in the list, like a browser opening a tab beside the one
// being viewed; at the end when there's no anchor. Ids already in the list stay where they are.
function insertAfter(ids: string[], anchor: string | null, added: string[]): string[] {
  const fresh = added.filter((id) => !ids.includes(id));
  const at = anchor === null ? -1 : ids.indexOf(anchor);
  return at >= 0 ? [...ids.slice(0, at + 1), ...fresh, ...ids.slice(at + 1)] : [...ids, ...fresh];
}

// Missions, Tests and Shortcuts are always pinned first; note tabs, then paper tabs, are opened,
// reordered and closed by the user.
// Everything here is persisted through app state, so every window restores the same tabs.
export function useWorkspace(notes: Note[], notesLoaded: boolean, papers: Paper[] | null) {
  const { workspace, workspaceStored, ready, patch, get } = useAppState();

  const noteIds = useMemo(() => new Set(notes.map((note) => note.id)), [notes]);
  const paperIds = useMemo(() => (papers ? new Set(papers.map((paper) => paper.id)) : null), [papers]);
  const openNoteIds = useMemo(
    () => workspace.openNoteIds.filter((id) => noteIds.has(id)),
    [workspace.openNoteIds, noteIds],
  );
  // Until the papers have loaded, their tabs wait rather than disappear.
  const openPaperIds = useMemo(
    () => (paperIds ? workspace.openPaperIds.filter((id) => paperIds.has(id)) : []),
    [workspace.openPaperIds, paperIds],
  );

  // The tab on show: a pinned one, or a note or paper that still exists.
  const activeTab = useMemo((): WorkspaceTab | null => {
    const tab = parseTabKey(workspace.activeTab);
    if (!tab || tab.kind === "view") return null;
    if (tab.kind === "note") return noteIds.has(tab.id) ? tab : null;
    if (tab.kind === "paper") return paperIds?.has(tab.id) ? tab : null;
    return tab;
  }, [workspace.activeTab, noteIds, paperIds]);

  // Once notes and stored state are both loaded: restore a first run, and drop tabs whose
  // notes or papers no longer exist (deleted here or from another window).
  useEffect(() => {
    if (!notesLoaded || !ready) return;

    if (!workspaceStored) {
      const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (recent) patch("workspace", { openNoteIds: [recent.id], activeTab: tabKey(noteTab(recent.id)) });
      return;
    }

    const current = get("workspace");
    const validNotes = current.openNoteIds.filter((id) => noteIds.has(id));
    const validPapers = paperIds ? current.openPaperIds.filter((id) => paperIds.has(id)) : current.openPaperIds;
    const active = parseTabKey(current.activeTab);
    const gone =
      (active?.kind === "note" && !noteIds.has(active.id)) ||
      (active?.kind === "paper" && paperIds !== null && !paperIds.has(active.id));
    const fallback = validNotes[0] ? noteTab(validNotes[0]) : validPapers[0] ? paperTab(validPapers[0]) : null;
    const activeKey = gone ? (fallback ? tabKey(fallback) : null) : current.activeTab;
    if (
      validNotes.length !== current.openNoteIds.length ||
      validPapers.length !== current.openPaperIds.length ||
      activeKey !== current.activeTab
    ) {
      patch("workspace", { openNoteIds: validNotes, openPaperIds: validPapers, activeTab: activeKey });
    }
  }, [notesLoaded, ready, workspaceStored, notes, noteIds, paperIds, get, patch]);

  // Shows a tab, opening it first if it's a note or paper that isn't open yet.
  const show = useCallback(
    (tab: WorkspaceTab) => {
      const current = get("workspace");
      const active = parseTabKey(current.activeTab);
      if (tab.kind === "note") {
        const anchor = active?.kind === "note" ? active.id : null;
        patch("workspace", { openNoteIds: insertAfter(current.openNoteIds, anchor, [tab.id]), activeTab: tabKey(tab) });
      } else if (tab.kind === "paper") {
        const anchor = active?.kind === "paper" ? active.id : null;
        patch("workspace", { openPaperIds: insertAfter(current.openPaperIds, anchor, [tab.id]), activeTab: tabKey(tab) });
      } else {
        patch("workspace", { activeTab: tabKey(tab) });
      }
    },
    [get, patch],
  );

  // Notes picked together in the sidebar open side by side after the tab being viewed; the
  // first of them is shown.
  const openNotes = useCallback(
    (ids: string[]) => {
      const first = ids[0];
      if (first === undefined) return;
      const current = get("workspace");
      const active = parseTabKey(current.activeTab);
      const anchor = active?.kind === "note" ? active.id : null;
      patch("workspace", {
        openNoteIds: insertAfter(current.openNoteIds, anchor, ids),
        activeTab: tabKey(noteTab(first)),
      });
    },
    [get, patch],
  );

  // Closes note and paper tabs: one, or several at once (Close others, to the left, to the
  // right, all). If the tab being viewed goes, `keep` takes over when it stays open, else the
  // nearest tab left open, as the tabs are shown.
  const close = useCallback(
    (tabs: WorkspaceTab[], keep?: WorkspaceTab) => {
      const current = get("workspace");
      const closing = new Set(tabs.map(tabKey));
      const stays = (tab: WorkspaceTab) => !closing.has(tabKey(tab));
      const order = [...current.openNoteIds.map(noteTab), ...current.openPaperIds.map(paperTab)];
      let activeKey = current.activeTab;
      if (activeKey && closing.has(activeKey)) {
        const index = order.findIndex((tab) => tabKey(tab) === activeKey);
        const after = order.slice(index + 1).find(stays);
        const before = order.slice(0, Math.max(0, index)).reverse().find(stays);
        const keeping = keep && stays(keep) && order.some((tab) => tabKey(tab) === tabKey(keep));
        const next = keeping ? keep : (after ?? before ?? null);
        activeKey = next ? tabKey(next) : null;
      }
      patch("workspace", {
        openNoteIds: current.openNoteIds.filter((id) => stays(noteTab(id))),
        openPaperIds: current.openPaperIds.filter((id) => stays(paperTab(id))),
        activeTab: activeKey,
      });
    },
    [get, patch],
  );

  const setMissionCadence = useCallback(
    (cadence: Cadence) => patch("workspace", { missionCadence: cadence }),
    [patch],
  );

  return {
    // Notes and stored tabs have both loaded, so an empty workspace really is empty.
    ready: notesLoaded && ready,
    openNoteIds,
    openPaperIds,
    activeTab,
    missionCadence: workspace.missionCadence,
    show,
    openNotes,
    close,
    setMissionCadence,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
