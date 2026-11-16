// Notes: saving, what a save may carry, deleting, and two windows saving the same note.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("notes");
const { call } = api;

const save = (id, fields) => call("PUT", `/api/notes/${id}`, { title: "A note", content: "Text.", tags: [], ...fields });

test("notes: saved, listed newest first, and deleted", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/notes");
  assert.deepEqual(res.data, []);

  const older = randomUUID();
  const newer = randomUUID();
  res = await save(older, { title: "Older", tags: ["a", "b"], createdAt: 1_000, updatedAt: 2_000 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.note, {
    id: older,
    title: "Older",
    content: "Text.",
    tags: ["a", "b"],
    language: "",
    groupId: null,
    position: 1,
    createdAt: 1_000,
    updatedAt: 2_000,
  });
  await save(newer, { title: "Newer", createdAt: 3_000, updatedAt: 4_000 });
  res = await call("GET", "/api/notes");
  assert.deepEqual(res.data.map((note) => note.title), ["Newer", "Older"]);
  ok("a note comes back as it was saved, and the list has the latest edit first");

  const before = Date.now();
  res = await save(randomUUID(), {});
  assert.ok(res.data.note.createdAt >= before && res.data.note.updatedAt >= before);
  ok("a save without times gets the time it arrived");

  for (const fields of [
    { title: 5 },
    { content: null },
    { tags: "one" },
    { tags: [1] },
    { position: "first" },
    { groupId: "not-an-id" },
    { createdAt: "yesterday" },
    { updatedAt: 1.5 },
    { updatedAt: -1 },
    { baseUpdatedAt: "2000" },
  ]) {
    res = await save(randomUUID(), fields);
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.equal(res.data.error, "Invalid note payload");
  }
  res = await save("not-an-id", {});
  assert.equal(res.status, 400);
  res = await call("PUT", `/api/notes/${randomUUID()}`, ["not", "an", "object"]);
  assert.equal(res.status, 400);
  ok("a save with a wrong kind of value anywhere, times included, is a 400 and stores nothing");

  res = await call("DELETE", `/api/notes/${older}`);
  assert.equal(res.status, 204);
  res = await call("DELETE", `/api/notes/${older}`);
  assert.equal(res.status, 404);
  assert.equal(res.data.error, "Note not found");
  res = await call("DELETE", "/api/notes/not-an-id");
  assert.equal(res.status, 404);
  ok("deleting answers 204 once, and 404 for a note that isn't there, like every other delete");
});

test("notes: a save doesn't overwrite what another window saved meanwhile", async (t) => {
  const ok = (label) => t.diagnostic(label);
  const id = randomUUID();

  // Both windows open the note as first saved, at edit time 100.
  let res = await save(id, { content: "First draft.", updatedAt: 100, baseUpdatedAt: null });
  assert.equal(res.status, 200);
  ok("a new note saves with no stored copy to compare against");

  res = await save(id, { content: "Window A's version.", updatedAt: 200, baseUpdatedAt: 100 });
  assert.equal(res.status, 200);
  assert.equal(res.data.note.content, "Window A's version.");
  ok("a window that started from the stored copy saves over it");

  res = await save(id, { content: "Window B's version.", updatedAt: 250, baseUpdatedAt: 100 });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /changed in another window/);
  assert.equal(res.data.note.content, "Window A's version.");
  assert.equal(res.data.note.updatedAt, 200);
  const stored = (await call("GET", "/api/notes")).data.find((note) => note.id === id);
  assert.equal(stored.content, "Window A's version.");
  ok("a window that started from an older copy is told so, gets the stored copy, and changes nothing");

  res = await save(id, { content: "Window B's version.", updatedAt: 250, baseUpdatedAt: 200 });
  assert.equal(res.status, 200);
  assert.equal(res.data.note.content, "Window B's version.");
  ok("having seen the stored copy, it can save over it");

  res = await save(id, { content: "Window B's version.", updatedAt: 250, baseUpdatedAt: 200 });
  assert.equal(res.status, 200);
  ok("the same save arriving twice (its answer was lost) isn't a conflict");

  res = await save(id, { content: "From a window that sends no base.", updatedAt: 300 });
  assert.equal(res.status, 200);
  assert.equal(res.data.note.content, "From a window that sends no base.");
  ok("a window from before this check, which sends no base, saves as it always did");
});
