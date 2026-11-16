import { isUuid } from "./model.js";

// The tabs above the document. Missions, Tests and Shortcuts are always there; notes and papers
// are opened and closed; a work's final view (named by the work's group id) exists only while
// its tab is open.
export type Tab =
  | { kind: "missions" }
  | { kind: "tests" }
  | { kind: "shortcuts" }
  | { kind: "note"; id: string }
  | { kind: "paper"; id: string }
  | { kind: "view"; id: string };

export type TabKind = Tab["kind"];

export const PINNED_TABS = ["missions", "tests", "shortcuts"] as const;

const ITEM_KINDS: readonly string[] = ["note", "paper", "view"];

// A tab as one string ("tests", "note:<id>"), for the stored workspace, React keys and the DOM.
// This and parseTabKey are the only places that know the format.
export function tabKey(tab: Tab): string {
  return "id" in tab ? `${tab.kind}:${tab.id}` : tab.kind;
}

export function parseTabKey(key: string | null | undefined): Tab | null {
  if (!key) return null;
  if (key === "missions" || key === "tests" || key === "shortcuts") return { kind: key };
  const split = key.indexOf(":");
  const kind = key.slice(0, split);
  const id = key.slice(split + 1);
  if (!ITEM_KINDS.includes(kind) || !isUuid(id)) return null;
  return { kind: kind as "note" | "paper" | "view", id };
}

export function sameTab(a: Tab | null, b: Tab | null): boolean {
  return a === null || b === null ? a === b : tabKey(a) === tabKey(b);
}

// What the workspace may store as its active tab. Final views are never stored: closing the
// window discards them.
export function isStoredTabKey(value: unknown): boolean {
  if (value === null) return true;
  const tab = typeof value === "string" ? parseTabKey(value) : null;
  return tab !== null && tab.kind !== "view";
}
