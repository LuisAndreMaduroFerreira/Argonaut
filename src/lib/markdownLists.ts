// Markdown list continuation for the note editor: Enter on a list item starts the next one.

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  caret: number;
}

// "* ", "- ", "+ ", "1. ", "1) ", optionally followed by a task box "[ ] " or "[x] ".
const LIST_ITEM = /^(\s*)([*+-]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?/;
const ORDERED_ITEM = /^(\s*)(\d{1,9})([.)])(\s+)/;
// "* * *" and "- - -" are horizontal rules, not list items.
const THEMATIC_BREAK = /^\s*([*_-])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;

function insideCodeFence(text: string, lineStart: number): boolean {
  let open = false;
  for (const line of text.slice(0, lineStart).split("\n")) {
    if (FENCE.test(line)) open = !open;
  }
  return open;
}

// Returns the edit Enter should make at `caret`, or null to let Enter behave as usual.
export function continueList(text: string, caret: number): TextEdit | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const newline = text.indexOf("\n", caret);
  const lineEnd = newline === -1 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd);
  const match = LIST_ITEM.exec(line);
  if (!match || THEMATIC_BREAK.test(line) || insideCodeFence(text, lineStart)) return null;

  const [marker, indent = "", bullet = "", gap = "", taskBox] = match;
  // With the cursor on the marker itself, Enter just opens a line, as usual.
  if (caret < lineStart + marker.length) return null;

  // Enter on an item with nothing in it ends the list.
  if (line.slice(marker.length).trim() === "") {
    return { from: lineStart, to: lineEnd, insert: "", caret: lineStart };
  }

  // Text after the cursor moves down into the new item.
  const rest = text.slice(caret, lineEnd).replace(/^\s+/, "");
  const box = taskBox ? "[ ] " : "";

  if (!/^\d/.test(bullet)) {
    const next = `${indent}${bullet}${gap}${box}`;
    return { from: caret, to: lineEnd, insert: `\n${next}${rest}`, caret: caret + 1 + next.length };
  }

  let number = Number.parseInt(bullet, 10) + 1;
  const next = `${indent}${number}${bullet.slice(-1)}${gap}${box}`;

  // Renumber the items that follow at this level, so the list stays in sequence.
  // Lines indented deeper belong to an item and are carried along unchanged.
  const following: string[] = [];
  let end = lineEnd;
  while (end < text.length) {
    const start = end + 1;
    const stop = text.indexOf("\n", start);
    const nextLine = text.slice(start, stop === -1 ? text.length : stop);
    const item = ORDERED_ITEM.exec(nextLine);
    if (item && item[1] === indent) {
      number += 1;
      following.push(`${indent}${number}${item[3]}${item[4]}${nextLine.slice(item[0].length)}`);
    } else if (nextLine.trim() !== "" && nextLine.startsWith(indent) && /^\s/.test(nextLine.slice(indent.length))) {
      following.push(nextLine);
    } else {
      break;
    }
    end = stop === -1 ? text.length : stop;
  }

  return {
    from: caret,
    to: end,
    insert: `\n${next}${rest}${following.map((entry) => `\n${entry}`).join("")}`,
    caret: caret + 1 + next.length,
  };
}

// insertText goes through the browser's own editing, so Ctrl+Z undoes the change in one step.
export function applyTextEdit(textarea: HTMLTextAreaElement, edit: TextEdit, fallback: (value: string) => void): void {
  textarea.setSelectionRange(edit.from, edit.to);
  const applied =
    edit.insert === ""
      ? edit.from === edit.to || document.execCommand("delete")
      : document.execCommand("insertText", false, edit.insert);
  if (applied) {
    textarea.setSelectionRange(edit.caret, edit.caret);
    return;
  }
  fallback(textarea.value.slice(0, edit.from) + edit.insert + textarea.value.slice(edit.to));
  requestAnimationFrame(() => textarea.setSelectionRange(edit.caret, edit.caret));
}
