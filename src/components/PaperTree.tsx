import { useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Paper, PaperFolder } from "../types";
import type { PapersNotice } from "../hooks/usePapers";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import { NameBox } from "./NameBox";
import {
  byName,
  depthStyle,
  FolderRow,
  MenuItem,
  MoreButton,
  pointerOf,
  underRow,
  useTreeError,
  type Point,
} from "./treeParts";

// The sidebar's Papers section: PDFs, in folders or none. Add them with the button beside
// Papers, or by dropping PDF files anywhere on the section (onto a folder to file them there).
// Drag a paper onto a folder to file it; a right-click (or ⋯) opens the menus.

interface PaperTreeProps {
  heading: ReactNode;
  open: boolean;
  papers: Paper[] | null;
  folders: PaperFolder[];
  activePaperId: string | null;
  collapsed: ReadonlySet<string>;
  uploading: number;
  notice: PapersNotice | null;
  // The heading's "New folder" button asks for a name box at the top.
  creatingFolder: boolean;
  onCreatingFolderDone: (fromKeyboard: boolean) => void;
  // Opens the file picker for PDFs going into a folder, or none.
  onPickFiles: (folderId: string | null) => void;
  onToggleFolder: (id: string, open?: boolean) => void;
  onOpen: (paper: Paper) => void;
  onAddFiles: (files: File[], folderId: string | null) => void;
  onMove: (paper: Paper, folderId: string | null) => Promise<void>;
  onDelete: (paper: Paper) => void;
  onCreateFolder: (name: string) => Promise<unknown>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (folder: PaperFolder) => void;
}

// Only Argonaut's own drags carry this; dropped files carry "Files".
const DRAG_TYPE = "application/x-argonaut-paper";

const byTitle = (a: Paper, b: Paper) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });

// "Vaswani, Shazeer, Parmar… (2017)" under the title when pointed at.
export function describePaper(paper: Paper): string {
  const authors = paper.authors.split(/\s*[,;]\s*/).filter(Boolean);
  const who = authors.length > 3 ? `${authors.slice(0, 3).join(", ")}…` : authors.join(", ");
  return [paper.title, [who, paper.year ? `(${paper.year})` : ""].filter(Boolean).join(" ")].filter(Boolean).join("\n");
}

type MenuState =
  | { kind: "paper"; paper: Paper; at: Point; moving: boolean }
  | { kind: "folder"; folder: PaperFolder; at: Point };

// These menus open in a portal, so they always need a position: the pointer's, or under the row.
const atPointer = (event: MouseEvent<HTMLElement>): Point => pointerOf(event) ?? underRow(event.currentTarget);

export function PaperTree({
  heading,
  open: sectionOpen,
  papers,
  folders,
  activePaperId,
  collapsed,
  uploading,
  notice,
  creatingFolder,
  onCreatingFolderDone,
  onPickFiles,
  onToggleFolder,
  onOpen,
  onAddFiles,
  onMove,
  onDelete,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: PaperTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Where a drag would land: a folder's id, or "top" for no folder.
  const [dropKey, setDropKey] = useState<string | null>(null);
  const { error, attempt } = useTreeError();
  const dragged = useRef<string | null>(null);

  const list = papers ?? [];

  // Files from the computer, or one of the papers here.
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes("Files") || dragged.current !== null;

  const dragOver = (event: DragEvent, key: string) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = dragged.current ? "move" : "copy";
    setDropKey(key);
  };

  const drop = (event: DragEvent, folderId: string | null) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropKey(null);
    const paperId = dragged.current;
    dragged.current = null;
    if (paperId) {
      const paper = list.find((candidate) => candidate.id === paperId);
      if (paper && paper.folderId !== folderId) {
        if (folderId) onToggleFolder(folderId, true);
        attempt(() => onMove(paper, folderId));
      }
      return;
    }
    const files = [...event.dataTransfer.files];
    if (files.length === 0) return;
    if (folderId) onToggleFolder(folderId, true);
    onAddFiles(files, folderId);
  };

  const renderPaper = (paper: Paper, depth: number) => {
    const active = paper.id === activePaperId;
    return (
      <li
        key={paper.id}
        className={`nav-item ${active ? "nav-item-active" : ""}`}
        style={depthStyle(depth)}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          dragged.current = paper.id;
          setMenu(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(DRAG_TYPE, paper.id);
        }}
        onDragEnd={() => {
          dragged.current = null;
          setDropKey(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ kind: "paper", paper, at: atPointer(event), moving: false });
        }}
      >
        <button
          type="button"
          id={`paper-${paper.id}`}
          className="nav-item-select nav-paper"
          aria-current={active ? "page" : undefined}
          title={describePaper(paper)}
          onClick={() => onOpen(paper)}
        >
          <Icon name="paper" size={15} />
          <span className="nav-paper-title">{paper.title}</span>
        </button>
      </li>
    );
  };

  const inFolder = (folderId: string | null) => list.filter((paper) => paper.folderId === folderId).sort(byTitle);
  const loose = list.filter((paper) => !paper.folderId || !folders.some((folder) => folder.id === paper.folderId)).sort(byTitle);

  const closeMenu = (returnFocusTo: string | null) => {
    setMenu(null);
    if (returnFocusTo) document.getElementById(returnFocusTo)?.focus();
  };

  const menuView = (() => {
    if (!menu) return null;
    if (menu.kind === "paper") {
      const { paper } = menu;
      const choose = (action: () => void) => () => {
        setMenu(null);
        action();
      };
      return (
        <Menu
          label={`${paper.title}: actions`}
          at={menu.at}
          focusKey={menu.moving}
          onEscape={() => (menu.moving ? setMenu({ ...menu, moving: false }) : closeMenu(`paper-${paper.id}`))}
          onDismiss={() => setMenu(null)}
        >
          {menu.moving ? (
            <>
              <p className="row-menu-heading">Move “{paper.title}” to</p>
              {[{ id: null as string | null, name: "No folder" }, ...[...folders].sort(byName)]
                .filter((folder) => folder.id !== (paper.folderId ?? null))
                .map((folder) => (
                  <MenuItem key={folder.id ?? "none"} onClick={choose(() => attempt(() => onMove(paper, folder.id)))}>
                    <Icon name={folder.id ? "folder" : "menu"} size={16} />
                    <span>{folder.name}</span>
                  </MenuItem>
                ))}
            </>
          ) : (
            <>
              <MenuItem onClick={choose(() => onOpen(paper))}>
                <span>Open</span>
              </MenuItem>
              <MenuItem disabled={folders.length === 0 && !paper.folderId} onClick={() => setMenu({ ...menu, moving: true })}>
                <span>Move to…</span>
              </MenuItem>
              <hr className="row-menu-divider" />
              <MenuItem danger onClick={choose(() => onDelete(paper))}>
                <span>Delete paper</span>
              </MenuItem>
            </>
          )}
        </Menu>
      );
    }
    const { folder } = menu;
    const choose = (action: () => void) => () => {
      setMenu(null);
      action();
    };
    return (
      <Menu
        label={`${folder.name}: actions`}
        at={menu.at}
        onEscape={() => closeMenu(`paper-folder-${folder.id}`)}
        onDismiss={() => setMenu(null)}
      >
        <MenuItem onClick={choose(() => onPickFiles(folder.id))}>
          <Icon name="paperPlus" size={16} />
          <span>Add papers here</span>
        </MenuItem>
        <MenuItem onClick={choose(() => setRenaming(folder.id))}>
          <span>Rename</span>
        </MenuItem>
        <hr className="row-menu-divider" />
        <MenuItem danger onClick={choose(() => onDeleteFolder(folder))}>
          <span>Delete folder</span>
        </MenuItem>
      </Menu>
    );
  })();

  return (
    <div
      className={`note-tree paper-tree ${dropKey === "top" ? "drop-top" : ""}`}
      onDragOver={(event) => dragOver(event, "top")}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropKey(null);
      }}
      onDrop={(event) => drop(event, null)}
    >
      {heading}
      {sectionOpen && (
        <>
          {(uploading > 0 || notice || error) && (
            <p className={`paper-status ${notice?.tone === "error" || error ? "paper-status-error" : ""}`} role="status">
              {uploading > 0
                ? `Adding ${uploading === 1 ? "a paper" : `${uploading} papers`}…`
                : (error ?? notice?.text)}
            </p>
          )}
          <ul className="nav-list">
            {creatingFolder && (
              <li>
                <NameBox depth={0} label="Name of the new folder of papers" onSubmit={onCreateFolder} onDone={onCreatingFolderDone} />
              </li>
            )}
            {[...folders].sort(byName).map((folder) => {
              const folderOpen = !collapsed.has(folder.id);
              const contents = inFolder(folder.id);
              return (
                <li key={folder.id} className="nav-group">
                  <FolderRow
                    toggleId={`paper-folder-${folder.id}`}
                    name={folder.name}
                    icon="folder"
                    depth={0}
                    open={folderOpen}
                    count={contents.length}
                    countLabel={contents.length === 1 ? "paper" : "papers"}
                    renaming={renaming === folder.id}
                    onRename={(name) => onRenameFolder(folder.id, name)}
                    onRenameDone={() => setRenaming(null)}
                    onToggle={() => onToggleFolder(folder.id)}
                    onContextMenu={(event) => setMenu({ kind: "folder", folder, at: atPointer(event) })}
                    className={dropKey === folder.id ? "drop-target" : ""}
                    rowProps={{
                      onDragOver: (event) => dragOver(event, folder.id),
                      onDrop: (event) => drop(event, folder.id),
                    }}
                    actions={
                      <>
                        <button
                          type="button"
                          className="icon-btn nav-row-action"
                          aria-label={`Add papers to ${folder.name}`}
                          title="Add papers here"
                          onClick={() => {
                            onToggleFolder(folder.id, true);
                            onPickFiles(folder.id);
                          }}
                        >
                          <Icon name="plus" size={16} />
                        </button>
                        <MoreButton
                          name={folder.name}
                          title="Add papers, rename, delete"
                          expanded={menu?.kind === "folder" && menu.folder.id === folder.id}
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenu({ kind: "folder", folder, at: { x: rect.left, y: rect.bottom + 4 } });
                          }}
                        />
                      </>
                    }
                  />
                  {folderOpen && (
                    <ul className="nav-list">
                      {contents.map((paper) => renderPaper(paper, 1))}
                      {contents.length === 0 && (
                        <li className="nav-empty" style={depthStyle(1)}>
                          Empty: drop PDFs here, or use +
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
            {loose.map((paper) => renderPaper(paper, 0))}
          </ul>
          {papers !== null && list.length === 0 && folders.length === 0 && !creatingFolder && (
            <p className="empty-hint">No papers yet. Drop PDFs here, or use the button beside Papers.</p>
          )}
        </>
      )}
      {menuView && createPortal(menuView, document.body)}
    </div>
  );
}
