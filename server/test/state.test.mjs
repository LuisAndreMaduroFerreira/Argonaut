// Interface state shared by every window: the open tabs and the preferences, patched a field
// at a time and checked by the validators the web app uses too (shared/appState.ts).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("state");
const { call } = api;
const patch = (key, fields) => call("PATCH", `/api/state/${key}`, fields);

test("state: fields are merged, and only values the app can use are stored", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/state");
  assert.deepEqual(res.data, { workspace: null, preferences: null });
  ok("nothing is stored at first");

  const note = randomUUID();
  const paper = randomUUID();
  assert.equal((await patch("workspace", { openNoteIds: [note], activeTab: `note:${note}` })).status, 204);
  assert.equal((await patch("workspace", { openPaperIds: [paper] })).status, 204);
  assert.equal((await patch("preferences", { theme: "light", collapsedSections: ["papers", "tests"] })).status, 204);
  res = await call("GET", "/api/state");
  assert.deepEqual(res.data, {
    workspace: { openNoteIds: [note], openPaperIds: [paper], activeTab: `note:${note}` },
    preferences: { theme: "light", collapsedSections: ["papers", "tests"] },
  });
  ok("each patch changes only the fields it names");

  for (const tab of ["missions", "tests", "shortcuts", `note:${note}`, `paper:${paper}`, null]) {
    assert.equal((await patch("workspace", { activeTab: tab })).status, 204, String(tab));
  }
  for (const tab of ["shortcut", "settings", "note:not-a-uuid", `view:${note}`, `book:${note}`, 7]) {
    res = await patch("workspace", { activeTab: tab });
    assert.equal(res.status, 400, String(tab));
    assert.equal(res.data.error, "Invalid value for workspace.activeTab");
  }
  ok("the active tab is one of the pinned three, a note or a paper; a final view is never stored");

  for (const [key, fields, message] of [
    ["workspace", { openNoteIds: Array.from({ length: 51 }, () => randomUUID()) }, "Invalid value for workspace.openNoteIds"],
    ["workspace", { openNoteIds: ["x"] }, "Invalid value for workspace.openNoteIds"],
    ["workspace", { missionCadence: "HOURLY" }, "Invalid value for workspace.missionCadence"],
    ["workspace", { zoom: 2 }, "Unknown workspace field: zoom"],
    ["preferences", { collapsedSections: ["books"] }, "Invalid value for preferences.collapsedSections"],
    ["preferences", { theme: "sepia" }, "Invalid value for preferences.theme"],
    ["preferences", { missionBriefingDay: "tomorrow" }, "Invalid value for preferences.missionBriefingDay"],
    ["preferences", {}, "No fields to update"],
    ["preferences", ["dark"], "Expected an object of fields"],
  ]) {
    res = await patch(key, fields);
    assert.equal(res.status, 400, JSON.stringify(fields).slice(0, 60));
    assert.equal(res.data.error, message);
  }
  res = await call("GET", "/api/state");
  assert.equal(res.data.preferences.theme, "light");
  ok("unknown fields and values the app couldn't use are refused, and what was stored stays");
});
