// Groups of notes (subgroups, renames, moves, deletion), notes filed in them, and tests the
// assistant writes from a group's notes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("groups");
const { call, sql } = api;
// The same app with no key for the assistant.
const noKey = await api.another({ llm: { baseUrl: api.llm.url, apiKey: "", model: "stand-in", settingsFile: "" } });

const byName = (groups, name, parentId) =>
  groups.find((group) => group.name === name && (parentId === undefined || group.parentId === parentId));

async function saveNote(note) {
  const now = Date.now();
  const full = { tags: [], language: "", createdAt: now, updatedAt: now, ...note };
  return call("PUT", `/api/notes/${full.id}`, full);
}

test("groups: subgroups, notes in them, and tests written from their notes", async (t) => {
  const ok = (label) => t.diagnostic(label);


  // --- groups
  let res = await call("POST", "/api/groups", { name: "  AI   agents  " });
  assert.equal(res.status, 201);
  assert.equal(res.data.group.name, "AI agents");
  assert.equal(res.data.group.parentId, null);
  const ai = res.data.group;
  ok("a group is created at the top level, its name tidied");

  res = await call("POST", "/api/groups", { name: "Skills", parentId: ai.id });
  assert.equal(res.status, 201);
  const skills = res.data.group;
  assert.equal(skills.parentId, ai.id);
  res = await call("POST", "/api/groups", { name: "French" });
  const french = res.data.group;
  res = await call("POST", "/api/groups", { name: "Skills", parentId: french.id });
  assert.equal(res.status, 201, "the same name is fine under another parent");
  const frenchSkills = res.data.group;
  ok("subgroups can be made, and siblings under different parents may share a name");

  res = await call("POST", "/api/groups", { name: "ai AGENTS" });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /already a group called “ai AGENTS”/);
  res = await call("POST", "/api/groups", { name: "   " });
  assert.equal(res.status, 400);
  res = await call("POST", "/api/groups", { name: "x".repeat(81) });
  assert.equal(res.status, 400);
  res = await call("POST", "/api/groups", { name: "Orphan", parentId: randomUUID() });
  assert.equal(res.status, 400);
  ok("duplicate names among siblings (any case), empty or long names and unknown parents are refused");

  res = await call("GET", "/api/groups");
  assert.deepEqual(
    res.data.map((group) => group.name),
    ["AI agents", "French", "Skills", "Skills"],
  );
  ok("the list comes back sorted by name");

  res = await call("PATCH", `/api/groups/${skills.id}`, { name: "Agent skills" });
  assert.equal(res.status, 200);
  assert.ok(byName(res.data, "Agent skills", ai.id));
  res = await call("PATCH", `/api/groups/${frenchSkills.id}`, { name: "Grammar" });
  res = await call("POST", "/api/groups", { name: "Vocabulary", parentId: french.id });
  const vocabulary = res.data.group;
  res = await call("PATCH", `/api/groups/${vocabulary.id}`, { name: "grammar" });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /already a group called “grammar”/);
  ok("renaming works, and can't clash with a sibling");

  res = await call("PATCH", `/api/groups/${ai.id}`, { parentId: ai.id });
  assert.equal(res.status, 400);
  res = await call("PATCH", `/api/groups/${ai.id}`, { parentId: skills.id });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /inside one of its own subgroups/);
  res = await call("PATCH", `/api/groups/${skills.id}`, { parentId: null });
  assert.equal(res.status, 200);
  assert.equal(byName(res.data, "Agent skills").parentId, null);
  res = await call("PATCH", `/api/groups/${skills.id}`, { parentId: ai.id });
  assert.equal(byName(res.data, "Agent skills").parentId, ai.id);
  res = await call("PATCH", `/api/groups/${randomUUID()}`, { name: "Nope" });
  assert.equal(res.status, 404);
  ok("groups move to the top level or into another group, never into themselves");

  // --- notes in groups
  const noteA = randomUUID();
  const noteB = randomUUID();
  const noteC = randomUUID();
  res = await saveNote({ id: noteA, title: "Progressive disclosure", content: "Layer 1 loads names.", groupId: skills.id });
  assert.equal(res.status, 200);
  assert.equal(res.data.note.groupId, skills.id);
  await saveNote({ id: noteB, title: "Context window", content: "Tokens are limited.", groupId: ai.id });
  await saveNote({ id: noteC, title: "Loose note", content: "Not in a group." });
  res = await call("GET", "/api/notes");
  const found = Object.fromEntries(res.data.map((note) => [note.id, note.groupId]));
  assert.equal(found[noteA], skills.id);
  assert.equal(found[noteC], null);
  ok("a note is saved with its group, and the notes list says which group each is in");

  res = await saveNote({ id: noteA, title: "Progressive disclosure", content: "Layer 1 loads names. Edited.", groupId: undefined });
  assert.equal(res.data.note.groupId, skills.id);
  ok("a save that doesn't mention the group (a window from before groups) leaves it alone");

  const before = await sql(`SELECT updated_at FROM notes WHERE id = '${noteC}'`);
  res = await call("PUT", `/api/notes/${noteC}/group`, { groupId: french.id });
  assert.equal(res.status, 204);
  assert.equal(await sql(`SELECT group_id FROM notes WHERE id = '${noteC}'`), french.id);
  assert.equal(await sql(`SELECT updated_at FROM notes WHERE id = '${noteC}'`), before);
  res = await call("PUT", `/api/notes/${noteC}/group`, { groupId: null });
  assert.equal(await sql(`SELECT group_id IS NULL FROM notes WHERE id = '${noteC}'`), "t");
  ok("moving a note between groups is stored at once and doesn't count as an edit");

  res = await call("PUT", `/api/notes/${randomUUID()}/group`, { groupId: null });
  assert.equal(res.status, 404);
  res = await call("PUT", `/api/notes/${noteC}/group`, { groupId: randomUUID() });
  assert.equal(res.status, 400);
  res = await call("PUT", `/api/notes/${noteC}/group`, {});
  assert.equal(res.status, 400);
  res = await saveNote({ id: noteC, title: "Loose note", content: "Not in a group.", groupId: randomUUID() });
  assert.equal(res.status, 200);
  assert.equal(res.data.note.groupId, null);
  ok("unknown notes and groups are refused, and saving into a vanished group leaves the note in none");

  // --- deleting a group
  await call("PUT", `/api/notes/${noteC}/group`, { groupId: vocabulary.id });
  res = await call("POST", "/api/groups", { name: "Grammar", parentId: vocabulary.id });
  const clash = res.data.group;
  res = await call("POST", "/api/groups", { name: "Vocabulary", parentId: vocabulary.id });
  const sameAsParent = res.data.group;
  res = await call("DELETE", `/api/groups/${vocabulary.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.parentId, french.id);
  assert.equal(await sql(`SELECT group_id FROM notes WHERE id = '${noteC}'`), french.id);
  const underFrench = res.data.groups.filter((group) => group.parentId === french.id).map((group) => group.name).sort();
  assert.deepEqual(underFrench, ["Grammar", "Grammar 2", "Vocabulary"]);
  assert.equal(res.data.groups.find((group) => group.id === clash.id).name, "Grammar 2");
  assert.equal(res.data.groups.find((group) => group.id === sameAsParent.id).name, "Vocabulary");
  ok("deleting a group moves its notes and subgroups up; a clashing name gets a number, nothing is lost");

  res = await call("DELETE", `/api/groups/${ai.id}`);
  assert.equal(res.data.parentId, null);
  assert.equal(await sql(`SELECT group_id IS NULL FROM notes WHERE id = '${noteB}'`), "t");
  assert.equal(byName(res.data.groups, "Agent skills").parentId, null);
  res = await call("DELETE", `/api/groups/${ai.id}`);
  assert.equal(res.status, 404);
  ok("a top-level group's contents move to the top level");

  // --- remembered open and closed groups
  res = await call("PATCH", "/api/state/preferences", { collapsedGroups: [skills.id] });
  assert.equal(res.status, 204);
  res = await call("PATCH", "/api/state/preferences", { collapsedGroups: ["not-an-id"] });
  assert.equal(res.status, 400);
  ok("which groups are closed is remembered, and only group ids are accepted");

  // --- tests from notes
  const notes = [
    {
      title: "Progressive disclosure",
      content:
        "Layer 1 loads names.\n\n![diagram](/api/attachments/5eed0000-0000-4000-8000-000000000000)\n\nSee [[Context window|the window]] and [[Skills]].",
    },
    { title: "Empty one", content: "   " },
    { title: "RAG", content: "Only relevant chunks go into the context window." },
  ];
  res = await call("POST", "/api/tests/generate", { source: "AI agents › Skills", notes, count: 6, kind: "mixed" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.questions, 6);
  assert.equal(res.data.notesUsed, 2);
  assert.equal(res.data.truncated, false);
  const made = res.data.tests.find((test) => test.id === res.data.id);
  assert.equal(made.title, "Agent context avenues");
  assert.equal(made.description, "Generated from AI agents › Skills · 2 notes");
  assert.equal(made.questionCount, 6);
  // Tests are listed oldest first, so an import keeps its file's order; the new one comes last.
  assert.equal(res.data.tests.at(-1).id, res.data.id, "the new test is last in the list");
  assert.equal(made.folderId, null, "a generated test is in no folder");
  ok("a test is written from the notes, stored, and described by where it came from");

  const sent = api.llm.lastRequest();
  const system = sent.messages[0].content;
  const user = sent.messages[1].content;
  assert.match(system, /exactly 6 questions/);
  assert.match(system, /Mix multiple-choice and open-answer/);
  assert.match(user, /The notes, from AI agents › Skills/);
  assert.match(user, /## Progressive disclosure/);
  assert.doesNotMatch(user, /attachments|!\[/);
  assert.match(user, /See the window and Skills\./);
  assert.doesNotMatch(user, /Empty one/);
  ok("the notes go as plain text: pictures and empty notes left out, links reduced to their words");

  res = await call("POST", "/api/tests/generate", {
    source: "RAG",
    notes: [notes[2]],
    count: 4,
    kind: "choice",
    instructions: "fenced, and ask in English",
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.questions, 2, "only the multiple-choice half of the reply is kept");
  const choiceTest = await call("GET", `/api/tests/${res.data.id}`);
  assert.ok(choiceTest.data.questions.every((question) => question.type === "choice"));
  assert.match(api.llm.lastRequest().messages[1].content, /The learner's instructions: fenced, and ask in English/);
  ok("a fenced reply is read, the learner's instructions are passed on, and the kind asked for is kept");

  res = await call("POST", "/api/tests/generate", { source: "RAG", notes: [notes[2]], count: 5, instructions: "broken-then-fixed" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const retried = api.llm.lastRequest().messages;
  assert.equal(retried.length, 4);
  assert.match(retried[3].content, /That can't be used as a test: .*isn't one of the options/);
  ok("an unusable reply gets one retry that says exactly what was wrong");

  const testsBefore = await sql("SELECT count(*) FROM tests");
  res = await call("POST", "/api/tests/generate", { source: "RAG", notes: [notes[2]], count: 5, instructions: "always-broken" });
  assert.equal(res.status, 502);
  assert.match(res.data.error, /wasn't a usable test: it isn't valid JSON/);
  assert.equal(await sql("SELECT count(*) FROM tests"), testsBefore);
  ok("a reply that's still unusable after the retry is reported, and nothing is stored");

  for (const [instructions, expected] of [
    ["no-title", "RAG — practice"],
    ["only-questions", "RAG — practice"],
  ]) {
    res = await call("POST", "/api/tests/generate", { source: "RAG", notes: [notes[2]], count: 3, instructions });
    assert.equal(res.status, 201, `${instructions}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.title, expected);
  }
  res = await call("POST", "/api/tests/generate", { source: "RAG", notes: [notes[2]], count: 3, instructions: "too-many" });
  assert.equal(res.data.questions, 3);
  res = await call("POST", "/api/tests/generate", { source: "RAG", notes: [notes[2]], count: 4, kind: "choice", instructions: "all-open" });
  assert.equal(res.status, 201, "the first reply had no multiple choice; the retry did");
  ok("a missing title, a bare question list and extra questions are all coped with");

  for (const [body, pattern] of [
    [{ notes: [] }, /Pick a group that has notes/],
    [{ notes: [notes[1]] }, /no text to make questions from/],
    [{ notes: [notes[2]], count: 2 }, /between 3 and 30/],
    [{ notes: [notes[2]], count: 31 }, /between 3 and 30/],
    [{ notes: [notes[2]], kind: "essay" }, /"kind" must be/],
    [{ notes: [notes[2]], instructions: "x".repeat(501) }, /at most 500/],
    [{ notes: [{ title: 1, content: "x" }] }, /needs a title and content/],
  ]) {
    res = await call("POST", "/api/tests/generate", { source: "x", ...body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.data.error, pattern);
  }
  ok("empty groups, notes without text, and out-of-range choices are refused before the assistant is asked");

  const long = Array.from({ length: 4 }, (_, index) => ({ title: `Chapter ${index + 1}`, content: "word ".repeat(5_000) }));
  res = await call("POST", "/api/tests/generate", { source: "Book", notes: long, count: 3 });
  assert.equal(res.status, 201);
  assert.equal(res.data.truncated, true);
  assert.equal(res.data.notesUsed, 3);
  const sentLong = api.llm.lastRequest().messages[1].content;
  assert.ok(sentLong.length < 61_000, `sent ${sentLong.length} characters`);
  assert.match(sentLong, /the rest was cut to keep the request small/);
  ok("long material is cut to about 60,000 characters, and the answer says so");

  res = await call("POST", "/api/tests/generate", { source: "RAG", notes: [notes[2]], count: 3 }, { base: noKey });
  assert.equal(res.status, 503);
  assert.match(res.data.error, /needs the AI assistant, which isn't connected yet/);
  ok("without an AI key, generating says the assistant isn't connected");
});
