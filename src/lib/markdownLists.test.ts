// Enter in a Markdown list: continuing it, renumbering it, ending it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { continueList } from "./markdownLists";

// Applies Enter at the "|" in the text and returns the result, with "|" marking the new caret.
function enter(withCaret: string): string | null {
  const caret = withCaret.indexOf("|");
  const text = withCaret.replace("|", "");
  const edit = continueList(text, caret);
  if (!edit) return null;
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return `${next.slice(0, edit.caret)}|${next.slice(edit.caret)}`;
}

test("*, - and + bullets continue with the same bullet", () => {
  assert.equal(enter("* first|"), "* first\n* |");
  assert.equal(enter("- first|"), "- first\n- |");
  assert.equal(enter("+ first|"), "+ first\n+ |");
});

test("numbered items count up, keeping the ) style and the indentation", () => {
  assert.equal(enter("1. one|"), "1. one\n2. |");
  assert.equal(enter("9) nine|"), "9) nine\n10) |");
  assert.equal(enter("   3. three|"), "   3. three\n   4. |");
});

test("items after the new one are renumbered, up to the end of the list", () => {
  assert.equal(enter("1. one|\n2. two\n3. three"), "1. one\n2. |\n3. two\n4. three");
  assert.equal(enter("1. one|\n   more about one\n2. two\n\n1. new list"), "1. one\n2. |\n   more about one\n3. two\n\n1. new list");
});

test("Enter on an empty item ends the list", () => {
  assert.equal(enter("* first\n* |"), "* first\n|");
  assert.equal(enter("1. one\n2. |"), "1. one\n|");
  assert.equal(enter("  - |"), "|");
});

test("text after the cursor moves into the new item", () => {
  assert.equal(enter("* hello| world"), "* hello\n* |world");
  assert.equal(enter("1. split| here\n2. two"), "1. split\n2. |here\n3. two");
});

test("task lists continue with an empty box", () => {
  assert.equal(enter("- [x] done|"), "- [x] done\n- [ ] |");
  assert.equal(enter("1. [ ] todo|"), "1. [ ] todo\n2. [ ] |");
});

test("plain text, the marker itself, bold, rules and code blocks are left alone", () => {
  assert.equal(enter("plain text|"), null);
  assert.equal(enter("|* first"), null);
  assert.equal(enter("**bold**|"), null);
  assert.equal(enter("* * *|"), null);
  assert.equal(enter("---|"), null);
  assert.equal(enter("-not a list|"), null);
  assert.equal(enter("```\n* inside code|"), null);
  assert.equal(enter("```\ncode\n```\n* after code|"), "```\ncode\n```\n* after code\n* |");
});

test("works mid-note without touching the text around the list", () => {
  assert.equal(enter("# Notes\n\n* a\n* b|\n\nAfter"), "# Notes\n\n* a\n* b\n* |\n\nAfter");
});
