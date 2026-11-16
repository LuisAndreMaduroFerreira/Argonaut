// The rules for joining a work's pages into its final view, and the export's file name.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countWords, endsSentence, finalViewFileName, joinPages } from "./finalView";

test("a page ending a sentence is followed by a new line", () => {
  assert.equal(joinPages(["The storm ended.", "Morning came."]), "The storm ended.\nMorning came.");
  assert.equal(joinPages(["Where was he?", "Nobody knew."]), "Where was he?\nNobody knew.");
  assert.equal(joinPages(["Run!", "They ran."]), "Run!\nThey ran.");
  assert.equal(joinPages(["She waited…", "Nothing."]), "She waited…\nNothing.");
  assert.equal(joinPages(["She waited...", "Nothing."]), "She waited...\nNothing.");
});

test("a sentence running on into the next page joins with a single space, no new line", () => {
  assert.equal(joinPages(["The wind carried", "the leaves away."]), "The wind carried the leaves away.");
  assert.equal(joinPages(["He listed them:", "bread, salt and oil."]), "He listed them: bread, salt and oil.");
  assert.equal(joinPages(["First,", "second."]), "First, second.");
  assert.equal(joinPages(["and then;", "silence."]), "and then; silence.");
});

test("closing quotes, brackets and emphasis after the stop still count as a finished sentence", () => {
  assert.equal(joinPages(['He said, "Go."', "She went."]), 'He said, "Go."\nShe went.');
  assert.equal(joinPages(["Il a dit : « Viens. »", "Elle est venue."]), "Il a dit : « Viens. »\nElle est venue.");
  assert.equal(joinPages(["(See the map.)", "They left."]), "(See the map.)\nThey left.");
  assert.equal(joinPages(["*The end.*", "Afterword."]), "*The end.*\nAfterword.");
  assert.equal(joinPages(["“Why?”", "No answer."]), "“Why?”\nNo answer.");
  assert.equal(joinPages(["the map (see below)", "shows it."]), "the map (see below) shows it.");
});

test("dashes: broken-off speech ends the line; a dash mid-sentence or mid-word joins with no space", () => {
  assert.equal(joinPages(['"I was going to—"', "She stopped him."]), '"I was going to—"\nShe stopped him.');
  assert.equal(joinPages(["The man—", "who had waited—left."]), "The man—who had waited—left.");
  assert.equal(joinPages(["a well-", "known story."]), "a well-known story.");
});

test("headings, list items, quotes and separators always start on a line of their own", () => {
  assert.equal(joinPages(["# Chapter 1", "It began."]), "# Chapter 1\nIt began.");
  assert.equal(joinPages(["The day ended and", "# Chapter 2\nA new day."]), "The day ended and\n# Chapter 2\nA new day.");
  assert.equal(joinPages(["Shopping:", "- bread\n- salt"]), "Shopping:\n- bread\n- salt");
  assert.equal(joinPages(["- bread", "and then home."]), "- bread\nand then home.");
  assert.equal(joinPages(["Part one", "---", "Part two"]), "Part one\n---\nPart two");
});

test("empty pages are skipped and the space around each page's text doesn't count", () => {
  assert.equal(joinPages(["  The end.  \n\n", "", "   ", "\nNext.\n"]), "The end.\nNext.");
  assert.equal(joinPages([]), "");
  assert.equal(joinPages(["", "Only page."]), "Only page.");
  assert.equal(joinPages(["Line one.\nLine two", "continues."]), "Line one.\nLine two continues.");
});

test("endsSentence is exported for the rule on its own", () => {
  assert.equal(endsSentence(""), true);
  assert.equal(endsSentence("word"), false);
  assert.equal(endsSentence("Done. "), true);
});

test("the export is named after the work and the date, with characters Windows refuses left out", () => {
  const when = new Date(2026, 8, 27);
  assert.equal(finalViewFileName("My Book", when), "My Book 2026-09-27.md");
  assert.equal(finalViewFileName('A: "Tale" / of <two>?', when), "A Tale of two 2026-09-27.md");
  assert.equal(finalViewFileName("Ends with dots...", when), "Ends with dots 2026-09-27.md");
  assert.equal(finalViewFileName("***", when), "*** 2026-09-27.md".replace("***", "Work"));
});

test("words are counted across lines", () => {
  assert.equal(countWords("One two\nthree  four"), 4);
  assert.equal(countWords("   "), 0);
});
