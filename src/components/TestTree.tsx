import { useState, type ReactNode } from "react";
import type { TestFolder, TestSummary } from "../types";
import { Menu } from "./Menu";
import { byName, depthStyle, FolderRow, MenuItem, MoreButton, pointerOf, type Point } from "./treeParts";

// The sidebar's Tests section: a folder for each import, holding its tests in the order the
// file gave them, then any test from no folder. Clicking a test starts it in the Tests tab; a
// folder shows how many of its tests are passed at 100%.

interface TestTreeProps {
  heading: ReactNode;
  open: boolean;
  tests: TestSummary[] | null;
  folders: TestFolder[];
  collapsed: ReadonlySet<string>;
  onToggleFolder: (id: string, open?: boolean) => void;
  onStart: (test: TestSummary) => void;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (folder: TestFolder) => void;
}

export function TestTree({
  heading,
  open: sectionOpen,
  tests,
  folders,
  collapsed,
  onToggleFolder,
  onStart,
  onRenameFolder,
  onDeleteFolder,
}: TestTreeProps) {
  const [menu, setMenu] = useState<{ folderId: string; at: Point | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const renderTest = (test: TestSummary, depth: number) => {
    const passed = test.bestPercent === 100;
    return (
      <li key={test.id} className="nav-item" style={depthStyle(depth)}>
        {/* Long titles are cut short by the sidebar's width; pointing at one shows it whole. */}
        <button type="button" className="nav-item-select nav-test" title={test.title} onClick={() => onStart(test)}>
          <span className="nav-test-title">{test.title}</span>
          <span className={`nav-test-score ${passed ? "nav-test-score-passed" : ""}`}>
            {passed ? "✓" : test.bestPercent !== null ? `${test.bestPercent}%` : ""}
            <span className="visually-hidden">
              {passed ? " passed at 100%" : test.bestPercent !== null ? " best score" : " not taken yet"}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const list = tests ?? [];
  const loose = list.filter((test) => !folders.some((folder) => folder.id === test.folderId));

  const renderFolder = (folder: TestFolder) => {
    const inFolder = list.filter((test) => test.folderId === folder.id);
    const passed = inFolder.filter((test) => test.bestPercent === 100).length;
    const open = !collapsed.has(folder.id);
    const moreId = `test-folder-more-${folder.id}`;
    const choose = (action: () => void) => () => {
      setMenu(null);
      action();
    };
    return (
      <li key={folder.id} className="nav-group">
        <FolderRow
          toggleId={`test-folder-toggle-${folder.id}`}
          name={folder.name}
          icon="folder"
          depth={0}
          open={open}
          count={`${passed}/${inFolder.length}`}
          countLabel="passed at 100%"
          renaming={renaming === folder.id}
          onRename={(name) => onRenameFolder(folder.id, name)}
          onRenameDone={() => setRenaming(null)}
          onToggle={() => onToggleFolder(folder.id)}
          onContextMenu={(event) => setMenu({ folderId: folder.id, at: pointerOf(event) })}
          actions={
            <MoreButton
              id={moreId}
              name={folder.name}
              title="Rename, delete"
              expanded={menu?.folderId === folder.id}
              onClick={() => setMenu(menu?.folderId === folder.id ? null : { folderId: folder.id, at: null })}
            />
          }
          menu={
            menu?.folderId === folder.id && (
              <Menu
                label={`${folder.name}: actions`}
                at={menu.at}
                onEscape={() => {
                  setMenu(null);
                  document.getElementById(moreId)?.focus();
                }}
                onDismiss={() => setMenu(null)}
              >
                <MenuItem onClick={choose(() => setRenaming(folder.id))}>Rename</MenuItem>
                <MenuItem danger onClick={choose(() => onDeleteFolder(folder))}>
                  Delete folder
                </MenuItem>
              </Menu>
            )
          }
        />
        {open && (
          <ul className="nav-list">
            {inFolder.map((test) => renderTest(test, 1))}
            {inFolder.length === 0 && (
              <li className="nav-empty" style={depthStyle(1)}>
                Empty
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="note-tree test-tree">
      {heading}
      {sectionOpen && (
        <>
          <ul className="nav-list">
            {[...folders].sort(byName).map(renderFolder)}
            {loose.map((test) => renderTest(test, 0))}
          </ul>
          {tests !== null && list.length === 0 && (
            <p className="empty-hint">No tests yet: import some, or make one from notes, in the Tests tab.</p>
          )}
        </>
      )}
    </div>
  );
}
