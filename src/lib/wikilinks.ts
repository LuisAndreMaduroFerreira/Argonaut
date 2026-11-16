import type { Note } from "../types";

// Links between notes: [[Note title]], or [[Note title|the words shown]] when the sentence
// reads better with different words.
const WIKILINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*?))?\]\]/g;

export interface Wikilink {
  start: number;
  end: number;
  target: string;
  label: string;
}

// Code blocks and `code` show [[brackets]] literally, so links inside them don't count.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

export function findWikilinks(text: string): Wikilink[] {
  const code = [...text.matchAll(CODE)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
  const inCode = (index: number) => code.some(([start, end]) => index >= start! && index < end!);
  return [...text.matchAll(WIKILINK)].flatMap((match) => {
    const start = match.index ?? 0;
    if (inCode(start)) return [];
    const target = (match[1] ?? "").trim();
    return [{ start, end: start + match[0].length, target, label: (match[2] ?? "").trim() || target }];
  });
}

// Characters a link can't hold ([ ] |) are dropped, and case and spacing don't matter, so a
// link still finds "Book continuation" when written [[book  Continuation]].
function cleanTitle(title: string): string {
  return title.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim();
}

export function titleKey(title: string): string {
  return cleanTitle(title).toLowerCase();
}

export function linkText(title: string, label: string): string {
  const target = cleanTitle(title);
  const shown = label.replace(/[[\]|\n]/g, " ").replace(/\s+/g, " ").trim();
  return shown && titleKey(shown) !== titleKey(target) ? `[[${target}|${shown}]]` : `[[${target}]]`;
}

// Title → note. When two notes share a title, the more recently edited one wins.
export function indexByTitle(notes: Note[]): Map<string, Note> {
  const index = new Map<string, Note>();
  for (const note of [...notes].sort((a, b) => a.updatedAt - b.updatedAt)) {
    const key = titleKey(note.title);
    if (key) index.set(key, note);
  }
  return index;
}

// Whether `note` links to a note with this title.
export function linksTo(note: Pick<Note, "content">, title: string): boolean {
  const key = titleKey(title);
  return key !== "" && findWikilinks(note.content).some((link) => titleKey(link.target) === key);
}
