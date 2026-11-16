// Find and replace, as in Notepad++: three search modes, match case, whole word, wrap around
// and a backward direction. Pure functions over a string, so the note editor and the rendered
// panes share them.

export type SearchMode = "normal" | "extended" | "regex";

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  wrapAround: boolean;
  backward: boolean;
  mode: SearchMode;
  // Regular expressions only: "." also matches a line break.
  dotAll: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  matchCase: false,
  wholeWord: false,
  wrapAround: true,
  backward: false,
  mode: "normal",
  dotAll: false,
};

export interface FindMatch {
  start: number;
  end: number;
  // Regular expressions: the captured groups, for $1 or \1 in the replacement.
  groups?: (string | undefined)[];
  named?: Record<string, string | undefined>;
}

export interface TextRange {
  start: number;
  end: number;
}

// Counting stops here, so a pattern like "e" in a book can't hang the window.
export const MAX_MATCHES = 10000;

// Extended mode: \n \r \t \0 \\ \xHH and \uHHHH, as in Notepad++. Notes keep their line breaks
// as \n alone, so a \r\n written out of habit still finds them.
export function decodeExtended(text: string): string {
  return text
    .replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|([nrt0\\]))/g, (_all, hex?: string, unicode?: string, simple?: string) => {
      if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
      if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
      return simple === "n" ? "\n" : simple === "r" ? "\r" : simple === "t" ? "\t" : simple === "0" ? "\0" : "\\";
    })
    .replace(/\r\n?/g, "\n");
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Compiled = { regex: RegExp } | { error: string };

// The pattern for a query, or null when there's nothing to look for. A regular expression is
// tried in Unicode mode first (\p{L} and friends), then the looser classic mode, so habits like
// "\-" still work.
export function compileFind(query: string, options: FindOptions): Compiled | null {
  if (query === "") return null;
  let source: string;
  if (options.mode === "regex") {
    source = query.replace(/\\r\\n/g, "\\n");
  } else {
    const literal = options.mode === "extended" ? decodeExtended(query) : query;
    if (literal === "") return null;
    source = escapeRegExp(literal);
  }
  const flags = `gm${options.matchCase ? "" : "i"}${options.mode === "regex" && options.dotAll ? "s" : ""}`;
  try {
    return { regex: new RegExp(source, `${flags}u`) };
  } catch {
    try {
      return { regex: new RegExp(source, flags) };
    } catch (error) {
      const text = error instanceof Error ? error.message : "invalid pattern";
      // "Invalid regular expression: /(/gmi: Unterminated group" → "Unterminated group"
      return { error: text.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, "") };
    }
  }
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
const isWordChar = (char: string | undefined) => char !== undefined && WORD_CHAR.test(char);

export function isWholeWord(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

// One step past `index`, keeping surrogate pairs whole in Unicode mode.
function advance(text: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= text.length) return index + 1;
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff ? index + 2 : index + 1;
}

// Every match, in order. Matches never overlap; a pattern that can match nothing (like ^)
// gives one empty match per place, which is what lets Replace All insert text there.
export function findAll(text: string, regex: RegExp, wholeWord: boolean, limit = MAX_MATCHES): FindMatch[] {
  const pattern = new RegExp(regex.source, regex.flags);
  const matches: FindMatch[] = [];
  while (matches.length < limit && pattern.lastIndex <= text.length) {
    const found = pattern.exec(text);
    if (!found) break;
    const start = found.index;
    const end = start + found[0].length;
    const counts = !wholeWord || isWholeWord(text, start, end);
    if (counts) {
      matches.push(
        found.length > 1 || found.groups
          ? { start, end, groups: found.slice(1), named: found.groups }
          : { start, end },
      );
    }
    // Past an empty match by one character; past one that only failed "whole word" by one
    // character too, since a whole word might start inside it.
    if (end === start || !counts) pattern.lastIndex = advance(text, start, pattern.unicode);
  }
  return matches;
}

// Where Find Next goes from the selection: forward, the first match starting at or after its
// end; backward, the last one ending at or before its start. The selection itself, when it is
// a match, is skipped. With wrap around, the search goes on from the other end.
export function pickMatch(
  matches: FindMatch[],
  selection: TextRange,
  backward: boolean,
  wrapAround: boolean,
): { index: number; wrapped: boolean } | null {
  if (matches.length === 0) return null;
  const isSelection = (match: FindMatch) => match.start === selection.start && match.end === selection.end;
  if (!backward) {
    const index = matches.findIndex((match) => match.start >= selection.end && !isSelection(match));
    if (index >= 0) return { index, wrapped: false };
    return wrapAround ? { index: 0, wrapped: true } : null;
  }
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    if (match.end <= selection.start && !isSelection(match)) return { index, wrapped: false };
  }
  return wrapAround ? { index: matches.length - 1, wrapped: true } : null;
}

export function indexOfRange(matches: FindMatch[], range: TextRange | null): number {
  if (!range) return -1;
  return matches.findIndex((match) => match.start === range.start && match.end === range.end);
}

function group(match: FindMatch, text: string, number: number): string {
  return number === 0 ? text.slice(match.start, match.end) : (match.groups?.[number - 1] ?? "");
}

// The text a match is replaced with. Normal: as typed. Extended: its escapes decoded. Regular
// expression: also $& (the match), $1 to $99 or \1 to \9 (groups), $<name> or ${name}, and $$
// for a dollar sign.
export function expandReplacement(replacement: string, match: FindMatch, text: string, mode: SearchMode): string {
  if (mode === "normal") return replacement;
  if (mode === "extended") return decodeExtended(replacement);
  const groupCount = match.groups?.length ?? 0;
  const expanded = replacement.replace(
    /\$\$|\$&|\$(\d{1,2})|\$<([^>]+)>|\$\{([^}]+)\}|\\(\d)|\\([nrt\\])/g,
    (token, dollar?: string, angle?: string, brace?: string, slash?: string, escape?: string) => {
      if (token === "$$") return "$";
      if (token === "$&") return group(match, text, 0);
      if (dollar !== undefined) {
        const number = Number(dollar);
        if (number <= groupCount || dollar.length === 1) return group(match, text, number);
        // "$12" with fewer than 12 groups is group 1, then a literal 2, as in JavaScript.
        return group(match, text, Number(dollar[0])) + dollar.slice(1);
      }
      const name = angle ?? brace;
      if (name !== undefined) {
        return /^\d+$/.test(name) ? group(match, text, Number(name)) : (match.named?.[name] ?? "");
      }
      if (slash !== undefined) return group(match, text, Number(slash));
      return escape === "n" || escape === "r" ? "\n" : escape === "t" ? "\t" : "\\";
    },
  );
  return expanded.replace(/\r\n?/g, "\n");
}

// The whole text with every match replaced, in one pass.
export function replaceAllIn(text: string, matches: FindMatch[], replacement: string, mode: SearchMode): string {
  let result = "";
  let last = 0;
  for (const match of matches) {
    result += text.slice(last, match.start) + expandReplacement(replacement, match, text, mode);
    last = match.end;
  }
  return result + text.slice(last);
}

// A query taken from selected text: one line, not too long, as Notepad++ does.
export function seedFromSelection(selected: string): string | null {
  if (selected === "" || selected.length > 200 || /[\r\n]/.test(selected)) return null;
  return selected;
}
