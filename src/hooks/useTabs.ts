import { useCallback, useMemo, useState } from "react";
import { PINNED_TABS, sameTab, tabKey, type Tab } from "../../shared/tabs";
import type { FinalViewData } from "../components/FinalView";
import type { Workspace, WorkspaceTab } from "./useWorkspace";

const isWorkspaceTab = (tab: Tab): tab is WorkspaceTab => tab.kind !== "view";
const viewTab = (id: string): Tab => ({ kind: "view", id });

// Every tab above the document as one list, and the one on show. The workspace's tabs are
// stored and shared by every window; the final views of works live only here, so closing a
// view's tab (or the window) discards it.
export function useTabs(workspace: Workspace) {
  const [views, setViews] = useState<FinalViewData[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const activeView = views.find((view) => view.groupId === activeViewId) ?? null;
  const { activeTab, openNoteIds, openPaperIds, show: showInWorkspace, close: closeInWorkspace, openNotes: openInWorkspace } = workspace;

  // An open final view takes the stage from whichever workspace tab was showing before it.
  const current = useMemo((): Tab | null => (activeView ? viewTab(activeView.groupId) : activeTab), [activeView, activeTab]);

  // In the order shown: the pinned three, the notes, the papers, the final views.
  const order = useMemo(
    (): Tab[] => [
      ...PINNED_TABS.map((kind) => ({ kind })),
      ...openNoteIds.map((id) => ({ kind: "note" as const, id })),
      ...openPaperIds.map((id) => ({ kind: "paper" as const, id })),
      ...views.map((view) => viewTab(view.groupId)),
    ],
    [openNoteIds, openPaperIds, views],
  );

  // Every way of showing a workspace tab steps out of a final view first.
  const show = useCallback(
    (tab: Tab) => {
      if (tab.kind === "view") {
        setActiveViewId(tab.id);
        return;
      }
      setActiveViewId(null);
      showInWorkspace(tab);
    },
    [showInWorkspace],
  );

  const openNotes = useCallback(
    (ids: string[]) => {
      setActiveViewId(null);
      openInWorkspace(ids);
    },
    [openInWorkspace],
  );

  // Close, close others, to the left, to the right, all: any mix of note, paper and view
  // tabs. When the tab being viewed goes, `keep` (the one right-clicked) takes its place.
  const close = useCallback(
    (tabs: Tab[], keep?: Tab) => {
      const closing = new Set(tabs.map(tabKey));
      const stays = (tab: Tab) => !closing.has(tabKey(tab));
      const stored = tabs.filter(isWorkspaceTab);
      if (stored.length > 0) closeInWorkspace(stored, keep && isWorkspaceTab(keep) ? keep : undefined);
      if (stored.length < tabs.length) setViews((open) => open.filter((view) => stays(viewTab(view.groupId))));
      if (current && !stays(current)) {
        if (keep && stays(keep)) show(keep);
        else if (current.kind === "view") setActiveViewId(null);
      }
    },
    [closeInWorkspace, current, show],
  );

  // Ctrl+Tab and Ctrl+Shift+Tab: the next or previous tab, round and round.
  const cycle = useCallback(
    (step: 1 | -1) => {
      const index = order.findIndex((tab) => sameTab(tab, current));
      const next = index < 0 ? (step === 1 ? 0 : order.length - 1) : (index + step + order.length) % order.length;
      const tab = order[next];
      if (tab) show(tab);
    },
    [current, order, show],
  );

  // Shows a work's final view. Generating it again replaces the open one in place, rather
  // than opening a second tab.
  const showView = useCallback((view: FinalViewData) => {
    setViews((open) =>
      open.some((other) => other.groupId === view.groupId)
        ? open.map((other) => (other.groupId === view.groupId ? view : other))
        : [...open, view],
    );
    setActiveViewId(view.groupId);
  }, []);

  return { current, order, views, activeView, show, openNotes, close, cycle, showView };
}
