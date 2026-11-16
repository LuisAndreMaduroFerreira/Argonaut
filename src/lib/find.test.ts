// Find and replace: modes, options, directions, wrapping, and what a replacement expands to.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FIND_OPTIONS,
  compileFind,
  decodeExtended,
  expandReplacement,
  findAll,
  indexOfRange,
  pickMatch,
  replaceAllIn,
  seedFromSelection,
  type FindOptions,
} from "./find";

const opts = (patch: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND_OPTIONS, ...patch });
const all = (text: string, query: string, patch: Partial<FindOptions> = {}) => {
  const compiled = compileFind(query, opts(patch));
  if (!compiled || "error" in compiled) throw new Error(`no pattern: ${JSON.stringify(compiled)}`);
  return findAll(text, compiled.regex, opts(patch).wholeWord);
};
const spans = (text: string, query: string, patch: Partial<FindOptions> = {}) =>
  all(text, query, patch).map((m) => text.slice(m.start, m.end));

test("normal mode finds the text literally, special characters included, any case", () => {
  // Normal mode is literal and ignores case by default.
  assert.deepEqual(spans("The cat. the Cat? (the)", "the"), ["The", "the", "the"]);
  assert.deepEqual(spans("a.b a+b a*b", "a.b"), ["a.b"]);
  assert.deepEqual(spans("price $5 (x) [y] {z} a|b", "$5 (x)"), ["$5 (x)"]);
  assert.deepEqual(spans("well-known, well known", "well-known"), ["well-known"]);
});

test("match case, and case-insensitive accents (é/É)", () => {
  assert.deepEqual(spans("The cat, the Cat", "Cat", { matchCase: true }), ["Cat"]);
  assert.deepEqual(spans("Été été ÉTÉ", "été"), ["Été", "été", "ÉTÉ"]);
});

test("whole word respects accented letters and underscores, and finds words after a failed candidate", () => {
  assert.deepEqual(spans("cat category bobcat cat's cat_1 cat", "cat", { wholeWord: true }), ["cat", "cat", "cat"]);
  assert.deepEqual(spans("café cafés o café.", "café", { wholeWord: true }), ["café", "café"]);
  assert.deepEqual(spans("aaa a aa a", "a", { wholeWord: true }), ["a", "a"]);
});

test("extended mode decodes \\n \\t \\\\ \\x \\u, and treats \\r\\n as the note's \\n; normal mode doesn't", () => {
  assert.equal(decodeExtended("a\\tb\\nc\\\\d\\x41\\u00e9"), "a\tb\nc\\dAé");
  assert.equal(decodeExtended("line\\r\\nnext"), "line\nnext");
  assert.deepEqual(spans("one\ntwo\tthree", "one\\ntwo\\tthree", { mode: "extended" }), ["one\ntwo\tthree"]);
  assert.equal(compileFind("\\n", opts({ mode: "normal" })) !== null, true);
  assert.deepEqual(spans("a\\nb", "\\n"), ["\\n"]);
});

test("regular expressions: ^ and $ per line, . across lines only when asked, \\p{L}, and the \\- habit", () => {
  assert.deepEqual(spans("Page 12, page 3 and page 45", "page (\\d+)", { mode: "regex" }), ["Page 12", "page 3", "page 45"]);
  assert.deepEqual(spans("first\nsecond\nthird", "^\\w+$", { mode: "regex" }), ["first", "second", "third"]);
  assert.deepEqual(spans("a\nb", "a.b", { mode: "regex" }), []);
  assert.deepEqual(spans("a\nb", "a.b", { mode: "regex", dotAll: true }), ["a\nb"]);
  assert.deepEqual(spans("naïve café", "\\p{L}+", { mode: "regex" }), ["naïve", "café"]);
  assert.deepEqual(spans("a-b", "a\\-b", { mode: "regex" }), ["a-b"]);
  assert.deepEqual(spans("x\ny", "x\\r\\ny", { mode: "regex" }), ["x\ny"]);
});

test("a broken expression gives a short reason; an empty query gives nothing to do", () => {
  const bad = compileFind("(unclosed", opts({ mode: "regex" }));
  assert.ok(bad && "error" in bad && /unterminated group/i.test(bad.error), JSON.stringify(bad));
  assert.equal(compileFind("", opts()), null);
  assert.equal(compileFind("\\x", opts({ mode: "extended" }))?.constructor, Object);
});

test("empty matches (like ^) come once per place, and Replace All inserts there", () => {
  // Empty matches: one per place, so Replace All can insert at every line start.
  const starts = all("one\ntwo\nthree", "^", { mode: "regex" });
  assert.deepEqual(starts.map((m) => m.start), [0, 4, 8]);
  assert.equal(replaceAllIn("one\ntwo\nthree", starts, "> ", "regex"), "> one\n> two\n> three");
});

test("next and previous from the selection, skipping it, wrapping only when allowed", () => {
  // Directions and wrapping.
  const text = "x a x a x a";
  const matches = all(text, "a");
  assert.deepEqual(matches.map((m) => m.start), [2, 6, 10]);
  assert.deepEqual(pickMatch(matches, { start: 0, end: 0 }, false, true), { index: 0, wrapped: false });
  assert.deepEqual(pickMatch(matches, { start: 2, end: 3 }, false, true), { index: 1, wrapped: false });
  assert.deepEqual(pickMatch(matches, { start: 10, end: 11 }, false, true), { index: 0, wrapped: true });
  assert.equal(pickMatch(matches, { start: 10, end: 11 }, false, false), null);
  assert.deepEqual(pickMatch(matches, { start: 6, end: 7 }, true, true), { index: 0, wrapped: false });
  assert.deepEqual(pickMatch(matches, { start: 2, end: 3 }, true, true), { index: 2, wrapped: true });
  assert.equal(pickMatch(matches, { start: 2, end: 3 }, true, false), null);
  assert.deepEqual(pickMatch(matches, { start: 4, end: 4 }, true, false), { index: 0, wrapped: false });
  assert.deepEqual(pickMatch([{ start: 5, end: 6 }], { start: 5, end: 6 }, false, true), { index: 0, wrapped: true });
  assert.equal(indexOfRange(matches, { start: 6, end: 7 }), 1);
  assert.equal(indexOfRange(matches, { start: 6, end: 8 }), -1);
});

test("an empty match at the cursor is skipped, so Find Next moves on", () => {
  assert.equal(compileFind("", opts({ mode: "regex" })), null);
  const zero = all("a\nb", "$", { mode: "regex" });
  assert.deepEqual(zero.map((m) => m.start), [1, 3]);
  assert.deepEqual(pickMatch(zero, { start: 1, end: 1 }, false, false), { index: 1, wrapped: false });
});

test("replacements: $1 and \\1 groups, $<name> and ${name}, $& and $$, escapes; literal in normal mode", () => {
  // Replacement expansion.
  const date = all("2026-09-30", "(\\d{4})-(\\d{2})-(?<day>\\d{2})", { mode: "regex" })[0]!;
  assert.equal(expandReplacement("$<day>/$2/$1", date, "2026-09-30", "regex"), "30/09/2026");
  assert.equal(expandReplacement("\\3.\\2.\\1", date, "2026-09-30", "regex"), "30.09.2026");
  assert.equal(expandReplacement("${day}|${1}|$&|$$|$0", date, "2026-09-30", "regex"), "30|2026|2026-09-30|$|2026-09-30");
  assert.equal(expandReplacement("$12", date, "2026-09-30", "regex"), "20262");
  assert.equal(expandReplacement("a\\nb\\tc\\\\d", date, "2026-09-30", "regex"), "a\nb\tc\\d");
  assert.equal(expandReplacement("$1 costs $5", date, "2026-09-30", "normal"), "$1 costs $5");
  assert.equal(expandReplacement("a\\nb", date, "2026-09-30", "extended"), "a\nb");
});

test("replace all swaps groups line by line and leaves case-mismatched text alone", () => {
  const swap = "John Smith\nJane Doe";
  const names = all(swap, "(\\w+) (\\w+)", { mode: "regex" });
  assert.equal(replaceAllIn(swap, names, "$2, $1", "regex"), "Smith, John\nDoe, Jane");
  assert.equal(replaceAllIn("a.a.a", all("a.a.a", "."), "-", "normal"), "a-a-a");
  assert.equal(replaceAllIn("Cat cat", all("Cat cat", "cat", { matchCase: true }), "dog", "normal"), "Cat dog");
});

test("selected text seeds the query only when it's a single, short line", () => {
  assert.equal(seedFromSelection("hello world"), "hello world");
  assert.equal(seedFromSelection("two\nlines"), null);
  assert.equal(seedFromSelection(""), null);
  assert.equal(seedFromSelection("x".repeat(201)), null);
});

test("counting stops at 10,000 matches", () => {
  const many = all("e".repeat(20000), "e");
  assert.equal(many.length, 10000);
});
