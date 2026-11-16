// Links between notes: [[Title]] and [[Title|words]], found, written and resolved.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Note } from "../types";
import { findWikilinks, indexByTitle, linkText, linksTo, titleKey } from "./wikilinks";

const note = (id: string, title: string, content = "", updatedAt = 1): Note => ({
  id,
  title,
  content,
  tags: [],
  language: "",
  groupId: null,
  position: null,
  createdAt: 0,
  updatedAt,
});

test("[[Title]] and [[Title|shown words]] are both understood, with exact positions", () => {
  assert.deepEqual(findWikilinks("See [[Book continuation]] now."), [
    { start: 4, end: 25, target: "Book continuation", label: "Book continuation" },
  ]);
  assert.deepEqual(findWikilinks("Learn [[Les prépositions de lieu|prepositions]] today.")[0], {
    start: 6,
    end: 47,
    target: "Les prépositions de lieu",
    label: "prepositions",
  });
});

test("links inside `code` and code blocks don't count", () => {
  assert.deepEqual(findWikilinks("`[[not a link]]` and\n```\n[[also not]]\n```\nbut [[yes]]").map((l) => l.target), ["yes"]);
});

test("empty or multi-line brackets aren't links", () => {
  assert.deepEqual(findWikilinks("[[]] [[a\nb]] [[x|y]]").map((l) => l.target), ["x"]);
});

test("linkText writes the short form when the words are the title, and strips characters a link can't hold", () => {
  assert.equal(linkText("Book continuation", "Book continuation"), "[[Book continuation]]");
  assert.equal(linkText("Book continuation", "book  CONTINUATION"), "[[Book continuation]]");
  assert.equal(linkText("Les prépositions de lieu", "prepositions"), "[[Les prépositions de lieu|prepositions]]");
  assert.equal(linkText("Odd [title] | here", "the\nwords"), "[[Odd title here|the words]]");
});

test("titles match ignoring case and spacing; the most recently edited note wins a tie; untitled notes aren't linkable", () => {
  assert.equal(titleKey("  Book   Continuation "), "book continuation");
  const index = indexByTitle([note("a", "Book continuation", "", 1), note("b", "book continuation", "", 5), note("c", "")]);
  assert.equal(index.get("book continuation")?.id, "b");
  assert.equal(index.size, 1);
});

test("linksTo finds backlinks, case-insensitively", () => {
  const french = note("f", "Les prépositions de lieu");
  assert.equal(linksTo(note("x", "X", "see [[les prépositions de lieu|here]]"), french.title), true);
  assert.equal(linksTo(note("y", "Y", "no links"), french.title), false);
  assert.equal(linksTo(note("z", "Z", "[[Untitled]]"), ""), false);
});
