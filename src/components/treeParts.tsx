import { useEffect, useState, type CSSProperties, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { Icon, type IconName } from "./Icon";
import { NameBox } from "./NameBox";

// What the sidebar's three trees (notes and works, papers, tests) have in common: indented
// rows, folders that open and close and are renamed in place, right-click menus, and a short
// error line for a change that didn't go through.

export interface Point {
  x: number;
  y: number;
}

export const depthStyle = (depth: number) => ({ "--depth": depth }) as CSSProperties;

export const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

// Where a right-click happened, or null for the context-menu key, which has no pointer position
// (the menu then hangs under its row).
export function pointerOf(event: MouseEvent): Point | null {
  return event.clientX !== 0 || event.clientY !== 0 ? { x: event.clientX, y: event.clientY } : null;
}

// Below the start of a row, for menus that need a position of their own.
export function underRow(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + 24, y: rect.bottom };
}

// Puts the focus on an element once the render under way has drawn it, as after a name box
// closes from the keyboard and the row it replaced comes back.
export function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

// A change that failed, shown above the tree for a few seconds. `attempt` runs one and catches.
export function useTreeError() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const attempt = (work: () => Promise<unknown>) => {
    setError(null);
    work().catch((cause: unknown) => setError(errorMessage(cause)));
  };
  return { error, attempt };
}

interface FolderRowProps {
  // The toggle button's id, which the focus goes back to after renaming from the keyboard.
  toggleId: string;
  name: string;
  icon: IconName;
  depth: number;
  open: boolean;
  // What the folder holds: the number shown, and its words for screen readers.
  count: ReactNode;
  countLabel: string;
  renaming: boolean;
  onRename: (name: string) => Promise<void>;
  onRenameDone: () => void;
  onToggle: () => void;
  // A right-click on the row, or the context-menu key.
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  // The buttons at the row's end (+, ⋯), and the menu when it's open.
  actions?: ReactNode;
  menu?: ReactNode;
  // Drag and drop, and the drop highlight.
  className?: string;
  rowProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}

export function FolderRow({
  toggleId,
  name,
  icon,
  depth,
  open,
  count,
  countLabel,
  renaming,
  onRename,
  onRenameDone,
  onToggle,
  onContextMenu,
  actions,
  menu,
  className = "",
  rowProps,
}: FolderRowProps) {
  return (
    <div
      {...rowProps}
      className={`nav-group-row ${className}`}
      style={depthStyle(depth)}
      onContextMenu={(event) => {
        if (renaming) return;
        event.preventDefault();
        onContextMenu(event);
      }}
    >
      {renaming ? (
        <NameBox
          initial={name}
          depth={0}
          label={`Rename ${name}`}
          onSubmit={onRename}
          onDone={(fromKeyboard) => {
            onRenameDone();
            if (fromKeyboard) focusSoon(toggleId);
          }}
        />
      ) : (
        <>
          {/* Long names are cut short by the sidebar's width; pointing at one shows it whole. */}
          <button id={toggleId} type="button" className="nav-group-toggle" title={name} aria-expanded={open} onClick={onToggle}>
            <span className="nav-group-chevron">
              <Icon name="chevron" size={14} />
            </span>
            <Icon name={icon} size={16} />
            <span className="nav-group-name">{name}</span>
            <span className="nav-group-count">
              {count}
              <span className="visually-hidden"> {countLabel}</span>
            </span>
          </button>
          {actions}
        </>
      )}
      {menu}
    </div>
  );
}

// The ⋯ button at the end of a folder's row.
export function MoreButton({
  id,
  name,
  title,
  expanded,
  onClick,
}: {
  id?: string;
  name: string;
  title: string;
  expanded: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      className="icon-btn nav-row-action"
      aria-label={`More for ${name}`}
      title={title}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon name="more" size={16} />
    </button>
  );
}

// A choice in a row's menu.
export function MenuItem({
  children,
  danger = false,
  disabled,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`row-menu-item${danger ? " danger" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
