// The stored interface state: what each field may hold, for the API (which refuses the rest)
// and for the web app (which falls back to its defaults).
import assert from "node:assert/strict";
import { test } from "node:test";
import { STATE_FIELDS, isStateKey, patchProblem, sanitizeState } from "./appState.js";
import { SIDEBAR_SECTIONS, isUuid, type PreferencesState, type WorkspaceState } from "./model.js";

const id = "5eed7a5c-0000-4000-8000-000000000001";
const workspace: WorkspaceState = { openNoteIds: [], openPaperIds: [], activeTab: null, missionCadence: "DAILY" };
const preferences: PreferencesState = {
  theme: "dark",
  voiceURI: "",
  missionBriefingDay: null,
  panelOpen: true,
  panelTab: "assistant",
  collapsedGroups: [],
  collapsedSections: [],
};

test("ids are told from other text", () => {
  assert.equal(isUuid(id), true);
  assert.equal(isUuid(id.toUpperCase()), true);
  for (const value of ["", "x", `${id}0`, id.slice(1), 5, null, undefined]) assert.equal(isUuid(value), false, String(value));
});

test("every field of the state has a rule, and only workspace and preferences are state", () => {
  assert.deepEqual(Object.keys(STATE_FIELDS.workspace).sort(), Object.keys(workspace).sort());
  assert.deepEqual(Object.keys(STATE_FIELDS.preferences).sort(), Object.keys(preferences).sort());
  assert.equal(isStateKey("workspace"), true);
  assert.equal(isStateKey("preferences"), true);
  assert.equal(isStateKey("notes"), false);
});

test("a patch is refused for an unknown field or a value the app couldn't use", () => {
  assert.equal(patchProblem("workspace", { openNoteIds: [id], activeTab: `note:${id}` }), null);
  assert.equal(patchProblem("preferences", { collapsedSections: [...SIDEBAR_SECTIONS], theme: "light" }), null);
  assert.equal(patchProblem("workspace", { zoom: 2 }), "Unknown workspace field: zoom");
  assert.equal(patchProblem("workspace", { activeTab: `view:${id}` }), "Invalid value for workspace.activeTab");
  assert.equal(patchProblem("preferences", { collapsedSections: ["books"] }), "Invalid value for preferences.collapsedSections");
  // A field named like something every object has isn't taken for a known one.
  assert.equal(patchProblem("preferences", { toString: "x" }), "Unknown preferences field: toString");
});

test("what was stored is used field by field; anything missing or wrong falls back", () => {
  const stored = { openNoteIds: [id], openPaperIds: "none", activeTab: "tests", extra: true };
  assert.deepEqual(sanitizeState("workspace", stored, workspace), {
    openNoteIds: [id],
    openPaperIds: [],
    activeTab: "tests",
    missionCadence: "DAILY",
  });
  assert.deepEqual(sanitizeState("workspace", null, workspace), workspace);
  assert.deepEqual(sanitizeState("workspace", "garbage", workspace), workspace);
});

test("every sidebar section can be remembered as closed", () => {
  // The web app once dropped "tests" here, because its own copy of this list had fallen behind.
  const closed = sanitizeState("preferences", { collapsedSections: ["notes", "works", "tests", "papers"] }, preferences);
  assert.deepEqual(closed.collapsedSections, ["notes", "works", "tests", "papers"]);
});
