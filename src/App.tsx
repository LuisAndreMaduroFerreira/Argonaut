import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tabKey } from "../shared/tabs";
import { Sidebar } from "./components/Sidebar";
import { NoteEditor } from "./components/NoteEditor";
import { AssistantPanel } from "./components/AssistantPanel";
import { AssistantSetup } from "./components/AssistantSetup";
import { MissionsBoard } from "./components/MissionsBoard";
import { TestsBoard } from "./components/TestsBoard";
import { ShortcutsPage } from "./components/ShortcutsPage";
import { FinalView, type FinalViewData } from "./components/FinalView";
import { FindPanel } from "./components/FindPanel";
import { PaperView, type PaperViewHandle } from "./components/PaperView";
import { MissionToasts } from "./components/MissionToasts";
import { SaveAlert } from "./components/SaveAlert";
import { TabStrip } from "./components/TabStrip";
import { EmptyWorkspace } from "./components/EmptyWorkspace";
import { Drawer } from "./components/Drawer";
import { Icon } from "./components/Icon";
import { useNotes } from "./hooks/useNotes";
import { Notices, useDialogs } from "./hooks/useDialogs";
import { useSaveConflict } from "./hooks/useSaveConflict";
import { useStableList } from "./hooks/useStableList";
import { useStableHandlers } from "./hooks/useStableHandlers";
import { useTheme } from "./hooks/useTheme";
import { useMissions } from "./hooks/useMissions";
import { useWorkspace } from "./hooks/useWorkspace";
import { useTabs } from "./hooks/useTabs";
import { useAppState } from "./hooks/useAppState";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useSidebarState } from "./hooks/useSidebarState";
import { useSearch } from "./hooks/useSearch";
import { useLayoutMode } from "./hooks/useLayoutMode";
import { useSpeech } from "./hooks/useSpeech";
import { useAssistantChat } from "./hooks/useAssistantChat";
import { useAssistantStatus } from "./hooks/useAssistantStatus";
import { useGroups } from "./hooks/useGroups";
import { useTests } from "./hooks/useTests";
import { useFind, type FindTarget } from "./hooks/useFind";
import { usePapers } from "./hooks/usePapers";
import { findRoot } from "./lib/findDom";
import { errorMessage } from "./lib/api";
import { MOD_KEY } from "./lib/platform";
import { indexByTitle, titleKey } from "./lib/wikilinks";
import { effectiveGroupId, groupLabel, notesDirectlyIn, notesInGroup, notesInReadingOrder, sectionOf } from "./lib/groups";
import { downloadMarkdown, finalViewFileName, joinPages } from "./lib/finalView";
import type { Note, NoteGroup, PanelTab, Paper, PaperFolder, TestFolder, TestSummary, ViewMode } from "./types";

const NO_NOTES: Note[] = [];

// What the sidebar shows of a note. Notes keep their identity when another one is edited.
const sameOutline = (a: Note, b: Note) =>
  a === b || (a.id === b.id && a.title === b.title && a.groupId === b.groupId && a.position === b.position);

// The app's frame: the sidebar, the tabs, the page the current tab shows, and the side panel.
// What each of them does lives in its own hook or component; this is where they meet.
export default function App() {
  const {
    allNotes,
    recentNotes,
    loaded,
    createNote,
    updateNote,
    replaceInNote,
    deleteNote,
    persistNote,
    moveNote,
    placeNotes,
    reassignGroup,
    saveStateOf,
    saveFailure,
    dismissSaveFailure,
    conflict,
    resolveConflict,
    offlineCopyFailed,
  } = useNotes();
  const { confirm, notify } = useDialogs();
  useSaveConflict(conflict, allNotes, resolveConflict);
  const { groups, createGroup, renameGroup, moveGroup, deleteGroup } = useGroups();
  const testsState = useTests();
  const papersState = usePapers();
  // A test picked in the sidebar, for the Tests tab to start; it clears this once it has.
  const [testToStart, setTestToStart] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();
  const { board } = useMissions();
  const { preferences, patch } = useAppState();
  const workspace = useWorkspace(allNotes, loaded, papersState.papers);
  const tabs = useTabs(workspace);
  const search = useSearch(allNotes, groups, papersState.papers, papersState.folders);
  // The notes as the sidebar and the link index read them: by title and place, not by text, so
  // typing in a note leaves both alone.
  const noteOutline = useStableList(allNotes, sameOutline);
  const recentOutline = useStableList(recentNotes, sameOutline);
  const searchOutline = useStableList(search.noteResults ?? NO_NOTES, sameOutline);
  const layout = useLayoutMode();
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  // On medium and narrow screens the panels open over the document instead of beside it.
  const [drawer, setDrawer] = useState<"nav" | "panel" | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // The document area, and the writing area in it when a note is being written: what Find
  // searches.
  const paneRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // The PDF viewer of the paper on screen, and the view around it (for its hint about searching).
  const paperFrameRef = useRef<HTMLIFrameElement | null>(null);
  const paperViewRef = useRef<PaperViewHandle | null>(null);

  // The tab on show, and the note or paper the workspace has in front. Those two stay what
  // they were while a work's final view covers them.
  const current = tabs.current;
  const activeNoteId = workspace.activeTab?.kind === "note" ? workspace.activeTab.id : null;
  const activePaperId = workspace.activeTab?.kind === "paper" ? workspace.activeTab.id : null;
  const activeNote = activeNoteId ? (allNotes.find((note) => note.id === activeNoteId) ?? null) : null;
  const activePaper = activePaperId ? (papersState.papers?.find((paper) => paper.id === activePaperId) ?? null) : null;
  const activeView = tabs.activeView;
  // The work behind the open view, unless it has since been deleted.
  const activeWork = activeView ? groups.find((group) => group.id === activeView.groupId) : undefined;

  const { show: showTab } = tabs;
  const openNote = useCallback((id: string) => showTab({ kind: "note", id }), [showTab]);
  const openShortcuts = useCallback(() => showTab({ kind: "shortcuts" }), [showTab]);
  const openPaper = (paper: Paper) => showTab({ kind: "paper", id: paper.id });

  // The note's group counts as a tag, for the assistant as everywhere else.
  const activeGroup = activeNote ? groupLabel(groups, effectiveGroupId(activeNote, groups)) : "";
  const noteForAssistant = useMemo(
    () => (activeNote && activeGroup ? { ...activeNote, tags: [activeGroup, ...activeNote.tags] } : activeNote),
    [activeNote, activeGroup],
  );

  // The conversation and the voice outlive the panel, so closing it loses nothing.
  const chat = useAssistantChat(noteForAssistant);
  const speech = useSpeech();
  const assistant = useAssistantStatus();

  const panelInline = layout === "wide" && preferences.panelOpen;
  const panelShown = panelInline || drawer === "panel";

  useEffect(() => {
    setDrawer(null);
  }, [layout]);

  const closeDrawer = useCallback(() => setDrawer(null), []);

  const togglePanel = () => {
    if (layout === "wide") patch("preferences", { panelOpen: !preferences.panelOpen });
    else setDrawer((open) => (open === "panel" ? null : "panel"));
  };

  const closePanel = () => {
    if (layout === "wide") patch("preferences", { panelOpen: false });
    else setDrawer(null);
  };

  const setPanelTab = (tab: PanelTab) => patch("preferences", { panelTab: tab });

  // Find works on the note being written, or else on the text of whatever the page shows.
  const pageKey = !current ? "empty" : current.kind === "note" ? `${tabKey(current)}:${viewMode}` : tabKey(current);
  const writing = current?.kind === "note" && viewMode === "edit";
  const reading = current?.kind === "paper";
  const findTarget: FindTarget =
    writing && activeNote
      ? { kind: "text", key: pageKey, text: activeNote.content, textarea: () => textareaRef.current }
      : { kind: "dom", key: pageKey, root: () => findRoot(paneRef.current) };
  const find = useFind(findTarget);

  useAppShortcuts({
    repeatFind: (backwards) => find.repeat(backwards),
    cycleTabs: tabs.cycle,
    find: (mode) => {
      // A paper is searched by the PDF viewer itself: it gets the focus, and the next Ctrl+F
      // opens its search box.
      if (reading) {
        paperFrameRef.current?.focus();
        paperViewRef.current?.showSearchHint();
        return;
      }
      find.openPanel(mode);
    },
    // A final view has nothing to save, and the note behind it isn't on screen.
    save: () => {
      if (activeNote && current?.kind !== "view") void persistNote(activeNote.id);
    },
    search: () => {
      if (layout === "narrow") setDrawer("nav");
      // The drawer mounts the search box on the next frame.
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    },
    showShortcuts: openShortcuts,
  });

  // The offline copy holds edits not yet saved; if it can't be written, saving is the only safety.
  useEffect(() => {
    if (offlineCopyFailed) {
      notify(
        "Offline copy not kept",
        `This window couldn't keep its offline copy of your notes. Save with ${MOD_KEY}+S before closing it.`,
      );
    }
  }, [offlineCopyFailed, notify]);

  const handleDeletePaper = async (paper: Paper) => {
    const what = paper.authors ? `“${paper.title}” by ${paper.authors}` : `“${paper.title}”`;
    const sure = await confirm({
      title: `Delete the paper ${what}?`,
      message: "Its PDF is deleted too. This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!sure) return;
    papersState.remove(paper.id).catch((cause: unknown) => notify("Paper not deleted", errorMessage(cause)));
  };

  const handleDeletePaperFolder = async (folder: PaperFolder) => {
    const inside = papersState.papers?.filter((paper) => paper.folderId === folder.id).length ?? 0;
    if (
      inside > 0 &&
      !(await confirm({
        title: `Delete the folder “${folder.name}”?`,
        message: `Its ${inside === 1 ? "paper stays" : `${inside} papers stay`}, in no folder.`,
        confirmLabel: "Delete folder",
      }))
    ) {
      return;
    }
    papersState.deleteFolder(folder.id).catch((cause: unknown) => notify("Folder not deleted", errorMessage(cause)));
  };

  // PDFs added from the sidebar; the first one opens, so it's there to read straight away.
  const addPapers = (files: File[], folderId: string | null) => {
    void papersState.add(files, folderId).then((added) => {
      if (added[0]) openPaper(added[0]);
    });
    closeDrawer();
  };

  // A delete the database turned down puts the note back, and says so.
  const removeNote = (id: string, title: string) =>
    deleteNote(id).catch((cause: unknown) =>
      notify("Note not deleted", `“${title || "Untitled"}” is back: ${errorMessage(cause)}`),
    );

  const handleDelete = async (id: string) => {
    const note = allNotes.find((candidate) => candidate.id === id);
    if (!note) return;
    if (
      note.content.trim().length > 0 &&
      !(await confirm({
        title: `Delete “${note.title || "Untitled"}”?`,
        message: "This can't be undone.",
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    void removeNote(id, note.title);
  };

  // Several notes picked in the sidebar: one question for all of them.
  const handleDeleteMany = async (ids: string[]) => {
    // In the order given, which is the sidebar's.
    const doomed = ids.flatMap((id) => allNotes.filter((note) => note.id === id));
    if (doomed.length === 0) return;
    if (doomed.length === 1) {
      await handleDelete(doomed[0]!.id);
      return;
    }
    const names = doomed.slice(0, 5).map((note) => `• ${note.title || "Untitled"}`);
    if (doomed.length > 5) names.push(`• and ${doomed.length - 5} more`);
    const sure = await confirm({
      title: `Delete ${doomed.length} notes?`,
      message: `This can't be undone.\n\n${names.join("\n")}`,
      confirmLabel: `Delete ${doomed.length} notes`,
    });
    if (!sure) return;
    const results = await Promise.allSettled(doomed.map((note) => deleteNote(note.id)));
    const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
    if (failures.length > 0) {
      notify(
        failures.length === 1 ? "A note wasn't deleted" : `${failures.length} notes weren't deleted`,
        `${failures.length === 1 ? "It is" : "They are"} back: ${errorMessage(failures[0])}`,
      );
    }
  };

  const handleNewNote = () => {
    openNote(createNote());
    closeDrawer();
  };

  // In a work, a new page is named for its place: the fifth page is "Page 5".
  const handleNewNoteIn = (groupId: string) => {
    const title =
      sectionOf(groups, groupId) === "works"
        ? `Page ${notesDirectlyIn(allNotes, groups, groupId).length + 1}`
        : "Untitled";
    openNote(createNote(title, { groupId }));
    closeDrawer();
  };

  // The sidebar's sections (Notes, Works, Papers, Tests) and the groups and folders in them,
  // each of which can be closed.
  const { collapsedGroups, collapsedSections, toggleGroup, toggleSection } = useSidebarState(activeNote, groups);

  // A group's notes and subgroups move up a level; nothing inside is deleted with it. A work's
  // own pages go to Notes, the only top level that holds notes.
  const handleDeleteGroup = async (group: NoteGroup) => {
    const inside = notesInGroup(allNotes, groups, group.id).length;
    const subgroups = groups.filter((other) => other.parentId === group.id).length;
    const parent = groups.find((other) => other.id === group.parentId);
    const section = sectionOf(groups, group.id);
    const inWorks = section === "works";
    const folderWord = section === "notes" ? "group" : "folder";
    const itemWord = inWorks ? "page" : section === "skills" ? "skill" : "note";
    const question =
      section === "skills" && !parent && inside > 0
        ? `Delete the folder “${group.name}”? Its skills move to Notes` +
          (subgroups > 0 ? ", and its subfolders stay in Agent Skills" : "") +
          "; no skill is deleted."
        : inWorks && !parent
        ? `Delete the work “${group.name}”? Its pages move to Notes` +
          (subgroups > 0 ? ", and its subfolders become works" : "") +
          "; no page is deleted."
        : `Delete the ${folderWord} “${group.name}”? What it holds moves to ` +
          `${parent ? `“${parent.name}”` : "the top level"}; no ${itemWord} is deleted.`;
    if ((inside > 0 || subgroups > 0) && !(await confirm({ title: question, confirmLabel: "Delete" }))) return;
    deleteGroup(group.id)
      .then((parentId) => reassignGroup(group.id, parentId))
      .catch((cause: unknown) => notify(`${inWorks && !parent ? "Work" : folderWord === "group" ? "Group" : "Folder"} not deleted`, errorMessage(cause)));
  };

  // Links name notes by title. A link to a title no note has yet creates that note, which is
  // how notes grow from inside other notes.
  const titleIndex = useMemo(() => indexByTitle(noteOutline), [noteOutline]);
  const hasNote = useCallback((title: string) => titleIndex.has(titleKey(title)), [titleIndex]);
  const openLink = useCallback(
    (title: string) => {
      const existing = titleIndex.get(titleKey(title));
      openNote(existing ? existing.id : createNote(title.trim(), { save: true }));
    },
    [titleIndex, openNote, createNote],
  );
  const createLinkedNote = useCallback((title: string) => void createNote(title, { save: true }), [createNote]);

  const handleSelectNote = (id: string) => {
    openNote(id);
    closeDrawer();
  };

  // A work's final view: every page under it, in sidebar order, joined as they are right now,
  // unsaved edits included.
  const buildView = useCallback(
    (group: NoteGroup): FinalViewData => {
      const pages = notesInReadingOrder(allNotes, groups, group.id);
      return {
        groupId: group.id,
        name: group.name,
        text: joinPages(pages.map((page) => page.content)),
        pages: pages.length,
        generatedAt: Date.now(),
      };
    },
    [allNotes, groups],
  );

  const generateView = (group: NoteGroup) => {
    tabs.showView(buildView(group));
    closeDrawer();
  };

  const exportText = (name: string, text: string) => {
    if (!text) {
      notify("Nothing to export", `“${name}” has no pages with text yet.`);
      return;
    }
    downloadMarkdown(text, finalViewFileName(name));
  };

  // A test clicked in the sidebar opens the Tests tab and starts there.
  const startTest = (test: TestSummary) => {
    showTab({ kind: "tests" });
    setTestToStart(test.id);
    closeDrawer();
  };

  const clearTestToStart = useCallback(() => setTestToStart(null), []);


  // The folder goes; its tests stay, listed after the folders, and keep their mission.
  const deleteFolderOfTests = async (folder: TestFolder) => {
    const sure = await confirm({
      title: `Delete the folder “${folder.name}”?`,
      message: "None of its tests is deleted: they move below the folders and still count for their weekly mission.",
      confirmLabel: "Delete folder",
    });
    if (!sure) return;
    testsState
      .deleteFolder(folder.id)
      .catch((cause: unknown) => notify("Folder not deleted", errorMessage(cause)));
  };

  const dailyTasks = board?.tasks.filter((task) => task.cadence === "DAILY") ?? [];
  const missionsBadge =
    dailyTasks.length > 0 ? `${dailyTasks.filter((task) => task.done).length}/${dailyTasks.length}` : null;

  // The note whose save failed last, unless it has since been deleted.
  const failedNote = saveFailure ? (allNotes.find((note) => note.id === saveFailure.noteId) ?? null) : null;

  const noteTabs = workspace.openNoteIds.flatMap((id) => {
    const note = allNotes.find((candidate) => candidate.id === id);
    return note ? [{ id, title: note.title, dirty: saveStateOf(note) !== "saved" }] : [];
  });
  const paperTabs = workspace.openPaperIds.flatMap((id) => {
    const paper = papersState.papers?.find((candidate) => candidate.id === id);
    return paper ? [{ id, title: paper.title }] : [];
  });

  // Kept the same from render to render, so the memoised sidebar isn't redrawn on every key.
  const sidebarHandlers = useStableHandlers({
    onStartTest: startTest,
    onRenameTestFolder: testsState.renameFolder,
    onDeleteTestFolder: deleteFolderOfTests,
    onOpenPaper: (paper: Paper) => {
      openPaper(paper);
      closeDrawer();
    },
    onAddPapers: addPapers,
    onMovePaper: (paper: Paper, folderId: string | null) => papersState.update(paper.id, { folderId }),
    onDeletePaper: handleDeletePaper,
    onCreatePaperFolder: papersState.createFolder,
    onRenamePaperFolder: papersState.renameFolder,
    onDeletePaperFolder: handleDeletePaperFolder,
    onQueryChange: search.setQuery,
    onSelect: handleSelectNote,
    onOpenNotes: (ids: string[]) => {
      tabs.openNotes(ids);
      closeDrawer();
    },
    onDeleteNotes: handleDeleteMany,
    onCreate: handleNewNote,
    onDelete: handleDelete,
    onToggleTheme: toggleTheme,
    onToggleGroup: toggleGroup,
    onToggleSection: toggleSection,
    onCreateNoteIn: handleNewNoteIn,
    onCreateGroup: createGroup,
    onRenameGroup: renameGroup,
    onMoveGroup: moveGroup,
    onDeleteGroup: handleDeleteGroup,
    onPlaceNotes: placeNotes,
    onGenerateView: generateView,
    onExportView: (group: NoteGroup) => exportText(group.name, buildView(group).text),
  });

  const sidebar = (
    <Sidebar
      {...sidebarHandlers}
      notes={noteOutline}
      groups={groups}
      searchResults={search.noteResults ? searchOutline : null}
      recentNotes={recentOutline}
      loaded={loaded}
      activeNoteId={activeNoteId}
      query={search.query}
      theme={theme}
      searchRef={searchRef}
      searchShortcut={`${MOD_KEY} K`}
      collapsedGroups={collapsedGroups}
      collapsedSections={collapsedSections}
      tests={testsState.tests}
      testFolders={testsState.folders}
      papers={papersState.papers}
      paperFolders={papersState.folders}
      activePaperId={activePaperId}
      paperResults={search.paperResults}
      papersUploading={papersState.uploading}
      papersNotice={papersState.notice}
      onClose={layout === "narrow" ? closeDrawer : undefined}
    />
  );

  const panel = (
    <AssistantPanel
      note={activeNote}
      chat={chat}
      speech={speech}
      status={assistant.status}
      tab={preferences.panelTab}
      onTabChange={setPanelTab}
      onClose={closePanel}
      onConfigure={() => setSetupOpen(true)}
    />
  );

  const documentTools = activeNote && (
    <>
      <div className="view-switch" role="group" aria-label="View">
        {(["edit", "preview"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`view-switch-option ${viewMode === mode ? "view-switch-option-active" : ""}`}
            aria-pressed={viewMode === mode}
            onClick={() => setViewMode(mode)}
          >
            {mode === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>
      {speech.isSupported && (
        <button
          type="button"
          className="tool-btn"
          onClick={() =>
            speech.status === "idle" ? speech.speak(`${activeNote.title}. ${activeNote.content}`) : speech.stop()
          }
        >
          <Icon name={speech.status === "idle" ? "sound" : "stop"} />
          <span className="tool-btn-label">{speech.status === "idle" ? "Read aloud" : "Stop reading"}</span>
        </button>
      )}
    </>
  );

  const panelToggle = (
    <button
      type="button"
      className={`tool-btn ${panelShown ? "tool-btn-active" : ""}`}
      aria-expanded={panelShown}
      aria-controls="side-panel"
      onClick={togglePanel}
    >
      <Icon name="panel" />
      <span className="tool-btn-label">Assistant</span>
    </button>
  );

  // What the current tab shows. The Tests tab's page is drawn apart, below, because it stays
  // mounted while hidden.
  const page = () => {
    switch (current?.kind) {
      case "view":
        return (
          activeView && (
            <FinalView
              key={activeView.groupId}
              view={activeView}
              hasNote={hasNote}
              onOpenLink={openLink}
              onRefresh={activeWork ? () => generateView(activeWork) : null}
              onExport={() => exportText(activeView.name, activeView.text)}
            />
          )
        );
      case "tests":
        return null;
      case "shortcuts":
        return <ShortcutsPage />;
      case "missions":
        return <MissionsBoard cadence={workspace.missionCadence} onCadenceChange={workspace.setMissionCadence} />;
      case "paper":
        return (
          activePaper && (
            <PaperView
              paper={activePaper}
              folders={papersState.folders}
              frameRef={paperFrameRef}
              handle={paperViewRef}
              onSave={(patchPaper) => papersState.update(activePaper.id, patchPaper)}
              onDelete={() => handleDeletePaper(activePaper)}
            />
          )
        );
      case "note":
        return (
          activeNote && (
            <NoteEditor
              note={activeNote}
              viewMode={viewMode}
              saveState={saveStateOf(activeNote)}
              onChange={(patchNote) => updateNote(activeNote.id, patchNote)}
              onReplaceContent={replaceInNote}
              tools={documentTools}
              notes={allNotes}
              hasNote={hasNote}
              onOpenLink={openLink}
              onCreateLinkedNote={createLinkedNote}
              onOpenNote={openNote}
              groups={groups}
              onMoveToGroup={(groupId) => moveNote(activeNote.id, groupId)}
              findMarks={find.marks}
              textareaRef={textareaRef}
            />
          )
        );
      case undefined:
        return workspace.ready ? (
          <EmptyWorkspace
            onNewNote={handleNewNote}
            onOpenMissions={() => showTab({ kind: "missions" })}
            onOpenTests={() => showTab({ kind: "tests" })}
          />
        ) : (
          <div className="pane-center" aria-busy="true" />
        );
    }
  };

  return (
    <div className={`app-layout layout-${layout} ${panelInline ? "panel-open" : ""}`}>
      {layout === "narrow" ? (
        <Drawer side="left" open={drawer === "nav"} label="Navigation" onClose={closeDrawer}>
          {sidebar}
        </Drawer>
      ) : (
        sidebar
      )}

      <main className="editor-pane" ref={paneRef}>
        <TabStrip
          noteTabs={noteTabs}
          paperTabs={paperTabs}
          viewTabs={tabs.views.map((view) => ({ id: view.groupId, title: view.name }))}
          current={current}
          missionsBadge={missionsBadge}
          leading={
            layout === "narrow" ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="Open navigation"
                aria-expanded={drawer === "nav"}
                onClick={() => setDrawer("nav")}
              >
                <Icon name="menu" />
              </button>
            ) : undefined
          }
          onShow={showTab}
          onClose={tabs.close}
          onNewNote={handleNewNote}
          actions={panelToggle}
        />
        {find.open && <FindPanel find={find} />}
        {/* Kept mounted while hidden, so a test in progress survives a look at a note. */}
        <div className="tests-pane" hidden={current?.kind !== "tests"}>
          <TestsBoard
            notes={allNotes}
            groups={groups}
            assistant={assistant.status}
            testsState={testsState}
            testToStart={testToStart}
            onTestStarted={clearTestToStart}
            onConfigure={() => setSetupOpen(true)}
          />
        </div>
        {page()}
      </main>

      {panelInline ? (
        panel
      ) : (
        <Drawer side="right" open={drawer === "panel"} label="Assistant and history" onClose={closeDrawer}>
          {panel}
        </Drawer>
      )}

      <AssistantSetup
        open={setupOpen}
        status={assistant.status}
        onCheck={assistant.refresh}
        onClose={() => setSetupOpen(false)}
      />
      {/* Pop-ups at the document's lower edge: task news, and below it a save that failed. */}
      <div className="toast-stack">
        <MissionToasts />
        <Notices />
        <SaveAlert
          failure={failedNote ? saveFailure : null}
          title={failedNote?.title ?? ""}
          saveState={failedNote ? saveStateOf(failedNote) : null}
          onRetry={() => {
            if (failedNote) void persistNote(failedNote.id);
          }}
          onDismiss={dismissSaveFailure}
        />
      </div>
    </div>
  );
}
