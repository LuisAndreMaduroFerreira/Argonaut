import { useEffect } from "react";
import { useLatest } from "./useLatest";

// What the app-wide keys do. Each is listed on the Shortcuts page (components/ShortcutsPage):
// keep the two in step when a key changes.
export interface AppShortcuts {
  // F3, and Shift+F3 for backwards: repeat the last search, from anywhere.
  repeatFind(backwards: boolean): void;
  // Ctrl+Tab and Ctrl+Shift+Tab, or Ctrl+PageDown and Ctrl+PageUp.
  cycleTabs(step: 1 | -1): void;
  // Ctrl+F and Ctrl+R: Argonaut's own Find and Replace, instead of the browser's find bar and
  // page reload.
  find(mode: "find" | "replace"): void;
  // Ctrl+S.
  save(): void;
  // Ctrl+K.
  search(): void;
  // Ctrl+/.
  showShortcuts(): void;
}

// One listener for the whole window, set up once: it reads the latest actions when a key
// arrives, so it never has to be taken down and put back as the app's state changes.
export function useAppShortcuts(actions: AppShortcuts): void {
  const latest = useLatest(actions);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const act = latest.current;
      if (event.key === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        act.repeatFind(event.shiftKey);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "Tab" || event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        act.cycleTabs(event.key === "PageUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1);
        return;
      }
      const key = event.key.toLowerCase();
      if ((key === "f" || key === "r") && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        act.find(key === "f" ? "find" : "replace");
      } else if (key === "s") {
        event.preventDefault();
        act.save();
      } else if (key === "k") {
        event.preventDefault();
        act.search();
      } else if (key === "/") {
        event.preventDefault();
        act.showShortcuts();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [latest]);
}
