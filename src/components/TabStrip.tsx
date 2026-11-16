import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sameTab, tabKey, type Tab } from "../../shared/tabs";
import { Icon, type IconName } from "./Icon";
import { Menu } from "./Menu";

interface TabStripProps {
  noteTabs: { id: string; title: string; dirty: boolean }[];
  // Papers being read, after the notes.
  paperTabs: { id: string; title: string }[];
  // Final views of works, which exist only while their tab is open.
  viewTabs: { id: string; title: string }[];
  // The tab on show, if any.
  current: Tab | null;
  missionsBadge: string | null;
  // Before the tabs, e.g. the navigation button on narrow screens.
  leading?: ReactNode;
  actions?: ReactNode;
  onShow: (tab: Tab) => void;
  // Closes tabs. If the one being viewed goes, `keep` (the tab that was right-clicked) takes over.
  onClose: (tabs: Tab[], keep?: Tab) => void;
  onNewNote: () => void;
}

// A tab that can be closed, as the strip draws it.
interface ClosableTab {
  tab: Tab;
  // What it's called in menus and tooltips.
  label: string;
  // What the tab itself says, after its icon when it has one.
  text: string;
  icon?: IconName;
  className: string;
  title: string;
  closeLabel: string;
  dirty: boolean;
}

const PINNED: { tab: Tab; text: string }[] = [
  { tab: { kind: "missions" }, text: "Missions" },
  { tab: { kind: "tests" }, text: "Tests" },
  { tab: { kind: "shortcuts" }, text: "Shortcuts" },
];

export function TabStrip({
  noteTabs,
  paperTabs,
  viewTabs,
  current,
  missionsBadge,
  leading,
  actions,
  onShow,
  onClose,
  onNewNote,
}: TabStripProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The right-click menu of a tab: which tab, and where it opened.
  const [menu, setMenu] = useState<{ tab: Tab; label: string; at: { x: number; y: number } } | null>(null);

  // The tabs that can close, in the order shown: notes, papers, then final views.
  const closable: ClosableTab[] = [
    ...noteTabs.map(({ id, title, dirty }): ClosableTab => {
      const label = title || "Untitled";
      return {
        tab: { kind: "note", id },
        label,
        text: label,
        className: dirty ? "strip-tab-dirty" : "",
        title: label,
        closeLabel: `Close ${label}`,
        dirty,
      };
    }),
    ...paperTabs.map(({ id, title }): ClosableTab => {
      const label = title || "Untitled paper";
      return {
        tab: { kind: "paper", id },
        label,
        text: label,
        icon: "paper",
        className: "strip-tab-paper",
        title: `${label} (paper)`,
        closeLabel: `Close ${label}`,
        dirty: false,
      };
    }),
    ...viewTabs.map(({ id, title }): ClosableTab => {
      const label = `${title}, final view`;
      return {
        tab: { kind: "view", id },
        label,
        text: title,
        icon: "book",
        className: "strip-tab-view",
        title: `${label}: closing the tab discards it`,
        closeLabel: `Close and discard the final view of ${title}`,
        dirty: false,
      };
    }),
  ];
  const closableTabs = closable.map((entry) => entry.tab);

  // Right-click, or the context-menu key (Shift+F10), on a tab that can close.
  const openMenu = (event: MouseEvent<HTMLElement>, entry: ClosableTab) => {
    event.preventDefault();
    const fromPointer = event.clientX !== 0 || event.clientY !== 0;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      tab: entry.tab,
      label: entry.label,
      at: fromPointer ? { x: event.clientX, y: event.clientY } : { x: rect.left, y: rect.bottom + 4 },
    });
  };

  const tabLabelOf = (tab: Tab) =>
    scrollRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabKey(tab))}"] .strip-tab-label`) ?? null;

  const closeMenu = (returnFocus: boolean) => {
    const tab = menu?.tab;
    setMenu(null);
    if (returnFocus && tab) tabLabelOf(tab)?.focus();
  };

  const choose = (tabs: Tab[], keep?: Tab) => () => {
    setMenu(null);
    onClose(tabs, keep);
    // Focus follows to whichever tab is shown now.
    window.setTimeout(
      () => scrollRef.current?.querySelector<HTMLElement>(".strip-tab-active .strip-tab-label, .strip-tab-active")?.focus(),
      0,
    );
  };

  const menuItems = (tab: Tab) => {
    const index = closableTabs.findIndex((other) => sameTab(other, tab));
    const left = closableTabs.slice(0, index);
    const right = closableTabs.slice(index + 1);
    const item = (label: string, tabs: Tab[], keep?: Tab) => (
      <button type="button" role="menuitem" className="row-menu-item" disabled={tabs.length === 0} onClick={choose(tabs, keep)}>
        <span>{label}</span>
      </button>
    );
    return (
      <>
        {item("Close", [tab])}
        {item("Close others", [...left, ...right], tab)}
        <hr className="row-menu-divider" />
        {item("Close tabs to the left", left, tab)}
        {item("Close tabs to the right", right, tab)}
        <hr className="row-menu-divider" />
        {item("Close all", closableTabs)}
      </>
    );
  };

  // Keep the active tab visible when many notes are open.
  const currentKey = current ? tabKey(current) : null;
  useEffect(() => {
    scrollRef.current?.querySelector(".strip-tab-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentKey, noteTabs.length, paperTabs.length, viewTabs.length]);

  return (
    <div className="tab-strip">
      {leading && <div className="tab-leading">{leading}</div>}
      <div className="tab-scroll" ref={scrollRef} role="tablist" aria-label="Open tabs">
        {PINNED.map(({ tab, text }) => {
          const active = sameTab(current, tab);
          return (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={active}
              className={`strip-tab strip-tab-pinned ${active ? "strip-tab-active" : ""}`}
              onClick={() => onShow(tab)}
            >
              <span>{text}</span>
              {tab.kind === "missions" && missionsBadge && (
                <span className="strip-badge" title="Daily tasks done today">
                  {missionsBadge}
                </span>
              )}
            </button>
          );
        })}
        <span className="strip-divider" aria-hidden="true" />
        {closable.map((entry) => {
          const active = sameTab(current, entry.tab);
          return (
            <div
              key={tabKey(entry.tab)}
              data-tab={tabKey(entry.tab)}
              className={`strip-tab ${entry.className} ${active ? "strip-tab-active" : ""}`}
              onAuxClick={(event) => {
                if (event.button === 1) onClose([entry.tab]);
              }}
              onContextMenu={(event) => openMenu(event, entry)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="strip-tab-label"
                title={entry.title}
                onClick={() => onShow(entry.tab)}
              >
                {entry.icon ? (
                  <>
                    <Icon name={entry.icon} size={14} />
                    <span>{entry.text}</span>
                  </>
                ) : (
                  entry.text
                )}
              </button>
              {entry.dirty && <span className="strip-dirty" title="Unsaved changes — Ctrl+S to save" />}
              <button type="button" className="strip-close" aria-label={entry.closeLabel} onClick={() => onClose([entry.tab])}>
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
        <button type="button" className="strip-new" aria-label="New note" title="New note" onClick={onNewNote}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      {actions && <div className="tab-actions">{actions}</div>}
      {/* On the page itself, so the tab strip's scrolling can't clip it. */}
      {menu &&
        createPortal(
          <Menu label={`${menu.label}: tab actions`} at={menu.at} onEscape={() => closeMenu(true)} onDismiss={() => closeMenu(false)}>
            {menuItems(menu.tab)}
          </Menu>,
          document.body,
        )}
    </div>
  );
}
