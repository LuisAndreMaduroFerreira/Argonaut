// Works (books written a page per note), the sidebar's sections, and the order of notes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("works");
const { call, sql } = api;

async function saveNote(note) {
  const now = Date.now();
  return call("PUT", `/api/notes/${note.id}`, { tags: [], language: "", createdAt: now, updatedAt: now, ...note });
}

async function orderOf(groupId) {
  const notes = (await call("GET", "/api/notes")).data.filter((note) => note.groupId === groupId);
  return notes.sort((a, b) => a.position - b.position).map((note) => note.title);
}

test("works: sections, the order of pages, and deleting a work", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("POST", "/api/groups", { name: "The Long Road", section: "works" });
  assert.equal(res.status, 201);
  const book = res.data.group;
  assert.equal(book.section, "works");
  res = await call("POST", "/api/groups", { name: "The Long Road" });
  assert.equal(res.status, 201, "a Notes group may share a work's name");
  assert.equal(res.data.group.section, "notes");
  const notesGroup = res.data.group;
  res = await call("POST", "/api/groups", { name: "the long road", section: "works" });
  assert.equal(res.status, 400);
  res = await call("POST", "/api/groups", { name: "Poems", section: "novels" });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /"section" must be/);
  ok("works live in their own section: a name is unique among works, and may match a group in Notes");

  res = await call("POST", "/api/groups", { name: "Part one", parentId: book.id, section: "notes" });
  assert.equal(res.status, 201);
  const partOne = res.data.group;
  assert.equal(partOne.section, null);
  res = await call("GET", "/api/groups");
  assert.equal(res.data.find((group) => group.id === partOne.id).section, null);
  assert.equal(await sql(`SELECT count(*) FROM note_groups WHERE parent_id IS NOT NULL AND section IS NOT NULL`), "0");
  ok("a subfolder takes its work's section, whatever the request says");

  res = await call("PATCH", `/api/groups/${notesGroup.id}`, { parentId: null, section: "works" });
  assert.equal(res.status, 400, "moving it beside the work of the same name clashes");
  res = await call("PATCH", `/api/groups/${notesGroup.id}`, { name: "Road notes", parentId: null, section: "works" });
  assert.equal(res.status, 200);
  assert.equal(res.data.find((group) => group.id === notesGroup.id).section, "works");
  res = await call("PATCH", `/api/groups/${notesGroup.id}`, { parentId: book.id });
  assert.equal(res.data.find((group) => group.id === notesGroup.id).section, null);
  res = await call("PATCH", `/api/groups/${notesGroup.id}`, { parentId: null, section: "notes" });
  assert.equal(res.data.find((group) => group.id === notesGroup.id).section, "notes");
  res = await call("PATCH", `/api/groups/${notesGroup.id}`, { parentId: null });
  assert.equal(res.data.find((group) => group.id === notesGroup.id).section, "notes", "no section given keeps the one it has");
  ok("groups move between sections, into a work as a subfolder, and back out");

  // --- ordering
  const pages = ["Page 1", "Page 2", "Page 3"].map((title) => ({ id: randomUUID(), title }));
  for (const page of pages) {
    res = await saveNote({ ...page, content: `${page.title} text.`, groupId: book.id });
    assert.equal(res.status, 200);
  }
  assert.deepEqual(await orderOf(book.id), ["Page 1", "Page 2", "Page 3"]);
  assert.deepEqual(
    (await call("GET", "/api/notes")).data.filter((note) => note.groupId === book.id).map((note) => note.position).sort(),
    [1, 2, 3],
  );
  ok("new notes saved without a place go last in their group, in the order they arrive");

  res = await saveNote({ ...pages[0], content: "Page 1, edited.", groupId: book.id, position: undefined });
  assert.equal(res.data.note.position, 1, "a save without a position keeps the note where it is");
  res = await saveNote({ ...pages[2], content: "Page 3 text.", groupId: book.id, position: 0.5 });
  assert.deepEqual(await orderOf(book.id), ["Page 3", "Page 1", "Page 2"]);
  ok("a save may carry the note's place; one without it keeps the note where it was");

  res = await call("PUT", "/api/notes/order", { groupId: book.id, noteIds: [pages[0].id, pages[1].id, pages[2].id] });
  assert.equal(res.status, 204);
  assert.deepEqual(await orderOf(book.id), ["Page 1", "Page 2", "Page 3"]);
  const beforeEdit = await sql(`SELECT updated_at FROM notes WHERE id = '${pages[1].id}'`);
  res = await call("PUT", "/api/notes/order", { groupId: book.id, noteIds: [pages[1].id, randomUUID(), pages[0].id, pages[2].id] });
  assert.equal(res.status, 204);
  assert.deepEqual(await orderOf(book.id), ["Page 2", "Page 1", "Page 3"]);
  assert.equal(await sql(`SELECT updated_at FROM notes WHERE id = '${pages[1].id}'`), beforeEdit);
  ok("reordering stores the new order at once, skips notes the database hasn't seen, and isn't an edit");

  const loose = { id: randomUUID(), title: "Loose idea" };
  await saveNote({ ...loose, content: "An idea." });
  res = await call("PUT", "/api/notes/order", { groupId: partOne.id, noteIds: [loose.id] });
  assert.equal(res.status, 204);
  assert.equal(await sql(`SELECT group_id FROM notes WHERE id = '${loose.id}'`), partOne.id);
  ok("ordering a group's list also files a newcomer there (a note dragged in from Notes)");

  for (const body of [
    { noteIds: [] },
    { groupId: null },
    { groupId: randomUUID(), noteIds: [] },
    { groupId: null, noteIds: ["x"] },
    { groupId: null, noteIds: [loose.id, loose.id] },
  ]) {
    res = await call("PUT", "/api/notes/order", body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  ok("orders naming an unknown group, repeating a note or missing a part are refused");

  res = await call("PUT", `/api/notes/${pages[0].id}/group`, { groupId: partOne.id });
  assert.equal(res.status, 204);
  assert.deepEqual(await orderOf(partOne.id), ["Loose idea", "Page 1"]);
  ok("moving a note to another group puts it last there");

  // --- deleting a work
  const topNote = { id: randomUUID(), title: "Already in Notes" };
  await saveNote({ ...topNote, content: "Top-level note." });
  const topBefore = (await call("GET", "/api/notes")).data.find((note) => note.id === topNote.id).position;
  res = await call("DELETE", `/api/groups/${book.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.parentId, null);
  const groupsAfter = res.data.groups;
  assert.equal(groupsAfter.find((group) => group.id === partOne.id).section, "works", "its subfolder becomes a work");
  const top = (await call("GET", "/api/notes")).data.filter((note) => note.groupId === null).sort((a, b) => a.position - b.position);
  assert.deepEqual(
    top.map((note) => note.title),
    ["Already in Notes", "Page 2", "Page 3"],
  );
  assert.ok(top.every((note, index) => index === 0 || note.position > top[index - 1].position));
  assert.equal(top[0].position, topBefore);
  ok("deleting a work moves its pages to the end of Notes, in order, and its subfolders become works");

  // --- Agent Skills: a third section of folders, each skill a note
  res = await call("POST", "/api/groups", { name: "Test Maker", section: "skills" });
  assert.equal(res.status, 201);
  const skillFolder = res.data.group;
  assert.equal(skillFolder.section, "skills");
  res = await call("POST", "/api/groups", { name: "Test Maker" });
  assert.equal(res.status, 201, "a Notes group may share a skills folder's name");
  const skill = { id: randomUUID(), title: "Test Maker", content: "# Test Maker", groupId: skillFolder.id };
  assert.equal((await saveNote(skill)).status, 200);
  res = await call("GET", "/api/notes");
  assert.equal(res.data.find((note) => note.id === skill.id).groupId, skillFolder.id);
  res = await call("PATCH", "/api/state/preferences", { collapsedSections: ["skills"] });
  assert.equal(res.status, 204);
  ok("agent skills live in their own section, as notes in folders, and the section can be closed");

  // --- remembered sections
  res = await call("PATCH", "/api/state/preferences", { collapsedSections: ["works"] });
  assert.equal(res.status, 204);
  res = await call("PATCH", "/api/state/preferences", { collapsedSections: ["books"] });
  assert.equal(res.status, 400);
  ok("which sections are closed is remembered, and only Notes and Works are accepted");

  // --- a database from before numbered migrations runs the baseline once more: it has to
  // leave a full schema alone, and still places notes from before ordering existed
  await sql("UPDATE notes SET position = NULL WHERE group_id IS NULL");
  await sql(readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8"));
  const placed = await sql("SELECT count(*) FROM notes WHERE position IS NULL");
  assert.equal(placed, "0");
  const reordered = (await call("GET", "/api/notes")).data.filter((note) => note.groupId === null);
  assert.equal(new Set(reordered.map((note) => note.position)).size, reordered.length, "every note gets its own place");
  ok("the baseline migration runs again cleanly and gives notes without a place one, last edited first");
});
