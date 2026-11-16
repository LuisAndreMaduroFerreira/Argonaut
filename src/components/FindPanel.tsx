import { useLayoutEffect, type KeyboardEvent } from "react";
import type { FindController } from "../hooks/useFind";
import type { FindOptions, SearchMode } from "../lib/find";
import { Icon } from "./Icon";

// Find and replace, docked under the tabs like Notepad++'s dialog but inside the page: Find or
// Replace, the search options, and a status line. It never covers the text it searches.

interface FindPanelProps {
  find: FindController;
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "extended", label: "Extended (\\n, \\t, \\x41…)" },
  { value: "regex", label: "Regular expression" },
];

// Alt+letter toggles, as in Notepad++'s dialog. Only while the focus is in the panel.
const TOGGLES: Record<string, keyof FindOptions> = { c: "matchCase", w: "wholeWord", p: "wrapAround", b: "backward" };
const MODE_KEYS: Record<string, SearchMode> = { n: "normal", x: "extended", g: "regex" };

export function FindPanel({ find }: FindPanelProps) {
  const { options } = find;
  const invalid = find.status?.tone === "error";

  // Opening with Ctrl+F or Ctrl+H puts the cursor in the query box, once this has drawn.
  const { takePendingFocus } = find;
  useLayoutEffect(takePendingFocus, [takePendingFocus, find.mode, find.query]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      find.close();
      return;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const toggle = TOGGLES[key];
    if (toggle) {
      event.preventDefault();
      find.setOption(toggle, !options[toggle]);
    } else if (MODE_KEYS[key]) {
      event.preventDefault();
      find.setOption("mode", MODE_KEYS[key]);
    }
  };

  const check = (key: "matchCase" | "wholeWord" | "wrapAround" | "backward" | "dotAll", label: string, keys?: string) => (
    <label className="find-check" title={keys ? `${label} (${keys})` : label}>
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(event) => find.setOption(key, event.target.checked)}
        aria-keyshortcuts={keys}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <section className="find-panel" aria-label="Find and replace" onKeyDown={onKeyDown} data-own-escape>
      <div className="find-inner">
        <div className="find-head">
          <div className="view-switch" role="group" aria-label="Find or replace">
            {(["find", "replace"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`view-switch-option ${find.mode === mode ? "view-switch-option-active" : ""}`}
                aria-pressed={find.mode === mode}
                onClick={() => find.setMode(mode)}
              >
                {mode === "find" ? "Find" : "Replace"}
              </button>
            ))}
          </div>
          <p id="find-status" className={`find-status ${invalid ? "find-status-error" : ""}`} role="status" aria-live="polite">
            {find.status?.text ?? ""}
          </p>
          <button type="button" className="icon-btn find-close" aria-label="Close find (Esc)" title="Close (Esc)" onClick={find.close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="find-row">
          <label className="find-label" htmlFor="find-query">
            Find what
          </label>
          <input
            ref={find.queryInputRef}
            id="find-query"
            className="find-input"
            value={find.query}
            onChange={(event) => find.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (event.shiftKey) find.findPrevious();
              else find.findNext();
            }}
            aria-invalid={invalid}
            aria-describedby="find-status"
            aria-keyshortcuts="Enter Shift+Enter"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="find-buttons">
            <button
              type="button"
              className="icon-btn find-step"
              aria-label="Find previous"
              title={options.backward ? "Previous: downwards (Shift+Enter, Shift+F3)" : "Previous (Shift+Enter, Shift+F3)"}
              onClick={find.findPrevious}
            >
              <Icon name={options.backward ? "arrowDown" : "arrowUp"} size={16} />
            </button>
            <button
              type="button"
              className="pill-btn primary find-next"
              title={`Find next${options.backward ? ", upwards" : ""} (Enter, F3)`}
              onClick={find.findNext}
            >
              Find next
            </button>
            <button type="button" className="pill-btn" onClick={find.count}>
              Count
            </button>
          </div>
        </div>

        {find.mode === "replace" && (
          <div className="find-row">
            <label className="find-label" htmlFor="find-replacement">
              Replace with
            </label>
            <input
              id="find-replacement"
              className="find-input"
              value={find.replacement}
              onChange={(event) => find.setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                find.replace();
              }}
              disabled={!find.canReplace}
              aria-describedby="find-status"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="find-buttons">
              <button type="button" className="pill-btn" onClick={find.replace} disabled={!find.canReplace}>
                Replace
              </button>
              <button type="button" className="pill-btn" onClick={find.replaceAll} disabled={!find.canReplace}>
                Replace all
              </button>
            </div>
          </div>
        )}
        {find.mode === "replace" && !find.canReplace && (
          <p className="find-hint">Replace works in a note while you're writing it: switch it to Edit.</p>
        )}

        <div className="find-options" role="group" aria-label="Search options">
          {check("matchCase", "Match case", "Alt+C")}
          {check("wholeWord", "Whole word", "Alt+W")}
          {check("wrapAround", "Wrap around", "Alt+P")}
          {check("backward", "Backward direction", "Alt+B")}
          <label className="find-mode">
            <span>Search mode</span>
            <select
              className="find-select"
              value={options.mode}
              onChange={(event) => find.setOption("mode", event.target.value as SearchMode)}
              title="Normal (Alt+N), Extended (Alt+X), Regular expression (Alt+G)"
            >
              {MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          {options.mode === "regex" && check("dotAll", ". matches newline")}
        </div>
      </div>
    </section>
  );
}
