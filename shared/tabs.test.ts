// Tab keys: the one place that knows how a tab is written as a string.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isStoredTabKey, parseTabKey, sameTab, tabKey, type Tab } from "./tabs.js";

const id = "5eed7a5c-0000-4000-8000-000000000001";

test("every kind of tab survives being written as a key and read back", () => {
  const tabs: Tab[] = [
    { kind: "missions" },
    { kind: "tests" },
    { kind: "shortcuts" },
    { kind: "note", id },
    { kind: "paper", id },
    { kind: "view", id },
  ];
  assert.deepEqual(tabs.map(tabKey), ["missions", "tests", "shortcuts", `note:${id}`, `paper:${id}`, `view:${id}`]);
  for (const tab of tabs) assert.deepEqual(parseTabKey(tabKey(tab)), tab);
});

test("anything that isn't a tab key reads as no tab", () => {
  for (const key of [null, undefined, "", "mission", "note:", "note:not-an-id", `book:${id}`, `note:${id}:edit`, id]) {
    assert.equal(parseTabKey(key), null, String(key));
  }
});

test("tabs are compared by what they show", () => {
  assert.equal(sameTab({ kind: "note", id }, { kind: "note", id }), true);
  assert.equal(sameTab({ kind: "note", id }, { kind: "paper", id }), false);
  assert.equal(sameTab({ kind: "tests" }, { kind: "tests" }), true);
  assert.equal(sameTab(null, null), true);
  assert.equal(sameTab(null, { kind: "tests" }), false);
});

test("the stored active tab is a pinned tab, a note, a paper or nothing; never a final view", () => {
  for (const key of ["missions", "tests", "shortcuts", `note:${id}`, `paper:${id}`, null]) {
    assert.equal(isStoredTabKey(key), true, String(key));
  }
  for (const key of [`view:${id}`, "settings", "note:x", 7, undefined, { kind: "tests" }]) {
    assert.equal(isStoredTabKey(key), false, String(key));
  }
});
