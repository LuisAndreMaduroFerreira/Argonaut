import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FIND_OPTIONS,
  MAX_MATCHES,
  compileFind,
  expandReplacement,
  findAll,
  indexOfRange,
  pickMatch,
  replaceAllIn,
  seedFromSelection,
  type FindMatch,
  type FindOptions,
  type TextRange,
} from "../lib/find";
import { clearDomMatches, paintDomMatches, rangeFor, readDomText, revealRange, type DomText } from "../lib/findDom";

// What Find works on: the note being written (a textarea, where Replace works too), or the
// rendered text of whatever the document area shows.
export type FindTarget =
  | { kind: "text"; key: string; text: string; textarea: () => HTMLTextAreaElement | null }
  | { kind: "dom"; key: string; root: () => HTMLElement | null };

export type FindMode = "find" | "replace";

// For the note editor, which draws them behind its text. `reveal` changes when the current
// match should be scrolled into view.
export interface FindMarks {
  matches: FindMatch[];
  current: number;
  reveal: number;
}

export interface FindStatus {
  text: string;
  tone: "info" | "error";
}

interface DomState {
  root: HTMLElement;
  dom: DomText;
  matches: FindMatch[];
  ranges: (Range | null)[];
}

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "es"}`;

// Replaces [from, to) through the browser's own editing, so Ctrl+Z undoes it in one step, and
// puts the page and the focus back where they were.
function editTextarea(textarea: HTMLTextAreaElement, from: number, to: number, insert: string, caret: number): void {
  const scroller = textarea.closest<HTMLElement>(".editor-scroll");
  const scrollTop = scroller?.scrollTop ?? 0;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(from, to);
  const applied =
    insert === "" ? from === to || document.execCommand("delete") : document.execCommand("insertText", false, insert);
  if (!applied) {
    // No editing command available: set the text directly (undo then can't reach it).
    textarea.setRangeText(insert, from, to, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  textarea.setSelectionRange(caret, caret);
  if (scroller) scroller.scrollTop = scrollTop;
  if (focused && focused !== textarea) focused.focus({ preventScroll: true });
}

export function useFind(target: FindTarget | null) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FindMode>("find");
  const [query, setQueryState] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<FindOptions>(DEFAULT_FIND_OPTIONS);
  // The match found last, as offsets into the searched text.
  const [current, setCurrent] = useState<TextRange | null>(null);
  // A passing remark after an action: wrapped, not found, replaced…
  const [note, setNote] = useState<FindStatus | null>(null);
  const [reveal, setReveal] = useState(0);
  // The panel's query box, which opening with Ctrl+F or Ctrl+H puts the cursor in (F3 opens the
  // panel without it, leaving the focus in the note).
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  // Set when opening should put the cursor there once the panel has drawn; the panel takes it
  // (see FindPanel), so it happens once and never again on a later redraw.
  const focusPending = useRef(false);
  const focusQuery = useCallback(() => {
    queryInputRef.current?.focus();
    queryInputRef.current?.select();
  }, []);
  const [domVersion, setDomVersion] = useState(0);
  const domRef = useRef<DomState | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const compiled = useMemo(() => compileFind(query, options), [query, options]);
  const regex = compiled && "regex" in compiled ? compiled.regex : null;
  const textTarget = target?.kind === "text" ? target : null;
  const targetKey = target?.key ?? null;

  const targetText = textTarget?.text;
  const textMatches = useMemo(
    () => (open && targetText !== undefined && regex ? findAll(targetText, regex, options.wholeWord) : []),
    [open, targetText, regex, options.wholeWord],
  );

  // A different note or pane: nothing found there yet.
  useEffect(() => {
    setCurrent(null);
    setNote(null);
  }, [targetKey]);

  // Rendered panes: read their text, search it, and paint the matches; again whenever the
  // pane changes under the search (a task ticked, a note reloaded).
  const domRoot = target?.kind === "dom" ? target.root : null;
  useEffect(() => {
    if (!open || !domRoot || !regex) {
      if (domRef.current) {
        domRef.current = null;
        clearDomMatches();
        setDomVersion((version) => version + 1);
      }
      return;
    }
    const root = domRoot();
    if (!root) return;
    const read = () => {
      const dom = readDomText(root);
      const matches = findAll(dom.text, regex, options.wholeWord);
      domRef.current = { root, dom, matches, ranges: matches.map((match) => rangeFor(dom, match)) };
      setDomVersion((version) => version + 1);
    };
    read();
    let timer = 0;
    const observer = new MutationObserver((records) => {
      // Painting highlights changes nothing in the page, so every change here is real.
      if (records.length === 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 150);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      clearDomMatches();
    };
    // The root function changes every render; the key says when the pane really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on targetKey, not domRoot
  }, [open, targetKey, regex, options.wholeWord]);

  useEffect(() => {
    const state = domRef.current;
    if (!state) return;
    const index = indexOfRange(state.matches, current);
    paintDomMatches(
      state.ranges.filter((range): range is Range => range !== null),
      index >= 0 ? (state.ranges[index] ?? null) : null,
    );
  }, [domVersion, current]);

  const matchesNow = useCallback((): { matches: FindMatch[]; text: string } | null => {
    if (!target || !regex) return null;
    if (target.kind === "text") {
      // The live text, in case an edit hasn't reached React yet.
      const text = target.textarea()?.value ?? target.text;
      return { matches: findAll(text, regex, options.wholeWord), text };
    }
    const root = target.root();
    if (!root) return null;
    const dom = readDomText(root);
    const matches = findAll(dom.text, regex, options.wholeWord);
    domRef.current = { root, dom, matches, ranges: matches.map((match) => rangeFor(dom, match)) };
    setDomVersion((version) => version + 1);
    return { matches, text: dom.text };
  }, [target, regex, options.wholeWord]);

  const selectionNow = useCallback((): TextRange => {
    const textarea = target?.kind === "text" ? target.textarea() : null;
    if (textarea) return { start: textarea.selectionStart, end: textarea.selectionEnd };
    return current ?? { start: 0, end: 0 };
  }, [target, current]);

  // Moves to a match: selects it in the note (or remembers it in a pane) and shows it.
  const land = useCallback(
    (match: FindMatch) => {
      const textarea = target?.kind === "text" ? target.textarea() : null;
      textarea?.setSelectionRange(match.start, match.end);
      setCurrent({ start: match.start, end: match.end });
      setReveal((count) => count + 1);
      const dom = domRef.current;
      if (target?.kind === "dom" && dom) {
        const range = dom.ranges[indexOfRange(dom.matches, match)];
        if (range) revealRange(range, dom.root);
      }
    },
    [target],
  );

  const problem = useMemo<FindStatus | null>(
    () =>
      compiled && "error" in compiled ? { text: `Invalid regular expression: ${compiled.error}`, tone: "error" } : null,
    [compiled],
  );

  const go = useCallback(
    (backward: boolean) => {
      const error = problem;
      if (error) {
        setNote(error);
        return;
      }
      const found = matchesNow();
      if (!found) {
        setNote({ text: query ? "Nothing here to search" : "Type something to find", tone: "info" });
        return;
      }
      if (found.matches.length === 0) {
        setNote({ text: `Can't find “${query}”`, tone: "info" });
        return;
      }
      const pick = pickMatch(found.matches, selectionNow(), backward, options.wrapAround);
      if (!pick) {
        setNote({ text: `No more matches ${backward ? "above" : "below"}; Wrap around searches the rest`, tone: "info" });
        return;
      }
      land(found.matches[pick.index]!);
      const place = `${(pick.index + 1).toLocaleString()} of ${found.matches.length.toLocaleString()}`;
      setNote(pick.wrapped ? { text: `${place} · continued from the ${backward ? "bottom" : "top"}`, tone: "info" } : null);
    },
    [matchesNow, selectionNow, options.wrapAround, land, query, problem],
  );

  const openPanel = useCallback(
    (nextMode: FindMode, { focus = true }: { focus?: boolean } = {}) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !active.closest(".find-panel")) returnFocus.current = active;
      // Selected text becomes the query, as in Notepad++.
      let selected = "";
      const textarea = target?.kind === "text" ? target.textarea() : null;
      if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
        selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      } else if (target?.kind === "dom") {
        selected = window.getSelection()?.toString() ?? "";
      }
      const seed = seedFromSelection(selected);
      if (seed !== null) setQueryState(seed);
      setMode(nextMode);
      setOpen(true);
      if (!focus) return;
      // A panel that mounts, changes mode or takes a new query draws again first, and takes the
      // focus then; one that stays as it is takes it now, since nothing will draw.
      const redraws = !open || nextMode !== mode || (seed !== null && seed !== query);
      if (redraws) focusPending.current = true;
      else focusQuery();
    },
    [target, open, mode, query, focusQuery],
  );

  // Called by the panel after it draws: puts the cursor in the query box if opening asked to.
  const takePendingFocus = useCallback(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    focusQuery();
  }, [focusQuery]);

  const close = useCallback(() => {
    setOpen(false);
    setNote(null);
    clearDomMatches();
    const textarea = target?.kind === "text" ? target.textarea() : null;
    // Back to the note with the match selected, so typing or Esc carries on from there.
    const back = textarea ?? returnFocus.current;
    returnFocus.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, [target]);

  // F3 and Shift+F3: repeat the last search without taking the focus away.
  const repeat = useCallback(
    (reverse: boolean) => {
      if (!query) {
        openPanel("find");
        return;
      }
      if (!open) openPanel(mode, { focus: false });
      go(reverse ? !options.backward : options.backward);
    },
    [query, open, mode, openPanel, go, options.backward],
  );

  const replace = useCallback(() => {
    const error = problem;
    if (error) {
      setNote(error);
      return;
    }
    const textarea = target?.kind === "text" ? target.textarea() : null;
    if (!textarea || !regex) {
      setNote({ text: "Replace works in a note while you're writing it (Edit)", tone: "info" });
      return;
    }
    const text = textarea.value;
    const matches = findAll(text, regex, options.wholeWord);
    const at = indexOfRange(matches, { start: textarea.selectionStart, end: textarea.selectionEnd });
    // As in Notepad++: the first press finds a match, the next one replaces it and moves on.
    if (at < 0) {
      go(options.backward);
      return;
    }
    const match = matches[at]!;
    const insert = expandReplacement(replacement, match, text, options.mode);
    const caret = options.backward ? match.start : match.start + insert.length;
    editTextarea(textarea, match.start, match.end, insert, caret);
    const after = findAll(textarea.value, regex, options.wholeWord);
    const pick = pickMatch(after, { start: caret, end: caret }, options.backward, options.wrapAround);
    if (pick) {
      land(after[pick.index]!);
      setNote({ text: pick.wrapped ? "Replaced 1 · continued from the other end" : "Replaced 1", tone: "info" });
    } else {
      setCurrent(null);
      setNote({ text: after.length === 0 ? "Replaced 1 · no more matches" : "Replaced 1 · none further this way", tone: "info" });
    }
  }, [target, regex, options, replacement, go, land, problem]);

  const replaceAll = useCallback(() => {
    const error = problem;
    if (error) {
      setNote(error);
      return;
    }
    const textarea = target?.kind === "text" ? target.textarea() : null;
    if (!textarea || !regex) {
      setNote({ text: "Replace works in a note while you're writing it (Edit)", tone: "info" });
      return;
    }
    const text = textarea.value;
    const matches = findAll(text, regex, options.wholeWord);
    if (matches.length === 0) {
      setNote({ text: `Can't find “${query}”`, tone: "info" });
      return;
    }
    // Only the stretch from the first match to the last changes, in one undoable step.
    const first = matches[0]!.start;
    const last = matches[matches.length - 1]!.end;
    const shifted = matches.map((match) => ({ ...match, start: match.start - first, end: match.end - first }));
    const middle = replaceAllIn(text.slice(first, last), shifted, replacement, options.mode);
    editTextarea(textarea, first, last, middle, first + middle.length);
    setCurrent(null);
    setNote({
      text: `Replaced ${plural(matches.length, "match")}${matches.length >= MAX_MATCHES ? " (the most at once; run it again for more)" : ""}`,
      tone: "info",
    });
  }, [target, regex, options, replacement, query, problem]);

  const count = useCallback(() => {
    const error = problem;
    if (error) {
      setNote(error);
      return;
    }
    const found = matchesNow();
    const total = found?.matches.length ?? 0;
    const where = target?.kind === "text" ? "in this note" : "on this page";
    setNote({
      text: `Count: ${total >= MAX_MATCHES ? `${MAX_MATCHES.toLocaleString()}+ matches` : plural(total, "match")} ${where}`,
      tone: "info",
    });
  }, [matchesNow, target, problem]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setNote(null);
  }, []);

  const setOption = useCallback(<K extends keyof FindOptions>(key: K, value: FindOptions[K]) => {
    setOptions((previous) => ({ ...previous, [key]: value }));
    setNote(null);
  }, []);

  // What the panel shows: a remark after an action, else where the search stands.
  const matchList = target?.kind === "text" ? textMatches : (domRef.current?.matches ?? []);
  const status: FindStatus | null = (() => {
    const error = problem;
    if (error) return error;
    if (note) return note;
    if (!query || !regex) return null;
    const total = matchList.length;
    if (total === 0) return { text: "No matches", tone: "info" };
    const index = indexOfRange(matchList, current);
    const totalText = total >= MAX_MATCHES ? `${MAX_MATCHES.toLocaleString()}+` : total.toLocaleString();
    return {
      text: index >= 0 ? `${(index + 1).toLocaleString()} of ${totalText}` : `${totalText} ${total === 1 ? "match" : "matches"}`,
      tone: "info",
    };
  })();

  const marks: FindMarks | null =
    open && textTarget && regex ? { matches: textMatches, current: indexOfRange(textMatches, current), reveal } : null;

  return {
    open,
    mode,
    query,
    replacement,
    options,
    status,
    marks,
    canReplace: target?.kind === "text",
    queryInputRef,
    takePendingFocus,
    openPanel,
    close,
    setMode,
    setQuery,
    setReplacement,
    setOption,
    findNext: () => go(options.backward),
    findPrevious: () => go(!options.backward),
    repeat,
    replace,
    replaceAll,
    count,
  };
}

export type FindController = ReturnType<typeof useFind>;
