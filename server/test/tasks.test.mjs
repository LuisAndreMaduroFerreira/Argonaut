// The task board and the assistant's changes to it: done marks, subtasks, edits, validation,
// and every task operation the assistant can ask for.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("tasks");
await api.seedTasks();
const { call } = api;

const FRENCH = "5eed7a5c-0000-4000-8000-000000000001";
const BOOK = "5eed7a5c-0000-4000-8000-000000000002";
const APP = "5eed7a5c-0000-4000-8000-000000000003";
const PREPOSITIONS = "5eed57b0-0000-4000-8000-000000000001";
const find = (board, id) => board.tasks.find((task) => task.id === id);

test("tasks: the board, done marks, edits, and changes by voice", async (t) => {
  const ok = (label) => t.diagnostic(label);

  // Board
  let res = await call("GET", "/api/tasks");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.tasks.map((t) => t.title), ["French learning", "Book Continuation", "Application Development"]);
  assert.deepEqual(Object.keys(res.data.periods).sort(), ["DAILY", "MONTHLY", "WEEKLY", "YEARLY"]);
  assert.equal(find(res.data, FRENCH).subtasks[0].subtext, "Transcribe and learn French prepositions");
  ok("board lists the three seeded daily tasks and four periods");

  // Subtask done completes its only-subtask task
  res = await call("PUT", `/api/subtasks/${PREPOSITIONS}/done`, { done: true });
  assert.equal(res.status, 200);
  assert.equal(find(res.data.board, FRENCH).done, true);
  assert.deepEqual(res.data.feedback, [
    { kind: "completed", title: "French learning", cadence: "DAILY", done: 1, total: 3, streak: 1 },
  ]);
  ok("ticking the only subtask completes the task, with 1/3 daily feedback");

  res = await call("PUT", `/api/subtasks/${PREPOSITIONS}/done`, { done: false });
  assert.equal(find(res.data.board, FRENCH).done, false);
  assert.deepEqual(res.data.feedback, []);
  ok("unticking it reopens the task");

  res = await call("PUT", `/api/tasks/${FRENCH}/done`, { done: true });
  assert.equal(find(res.data.board, FRENCH).subtasks[0].done, true);
  assert.equal(res.data.feedback[0].kind, "completed");
  ok("completing a task ticks its subtasks");

  res = await call("POST", `/api/tasks/${FRENCH}/subtasks`, { title: "Verbs", subtext: "Conjugate être" });
  assert.equal(res.status, 201);
  let french = find(res.data.board, FRENCH);
  assert.deepEqual(french.subtasks.map((s) => s.title), ["Prepositions", "Verbs"]);
  assert.equal(french.done, false);
  ok("adding an undone subtask reopens a done task");

  const verbs = french.subtasks[1].id;
  res = await call("DELETE", `/api/subtasks/${verbs}`);
  assert.equal(res.status, 200);
  assert.equal(find(res.data.board, FRENCH).done, true);
  assert.equal(res.data.feedback[0]?.kind, "completed");
  ok("removing the last undone subtask completes the task");

  res = await call("PUT", `/api/tasks/${FRENCH}/done`, { done: false });
  assert.equal(find(res.data.board, FRENCH).subtasks.every((s) => !s.done), true);
  ok("reopening a task clears its subtasks for this period");

  // Edits and validation
  res = await call("PATCH", `/api/tasks/${BOOK}`, { title: "  Book \n  Continuation  ", subtext: "Write 3 optimized pages today" });
  assert.equal(find(res.data.board, BOOK).title, "Book Continuation");
  ok("titles are trimmed to one line");

  res = await call("PATCH", `/api/tasks/${BOOK}`, { cadence: "weekly" });
  assert.equal(find(res.data.board, BOOK).cadence, "WEEKLY");
  res = await call("PATCH", `/api/tasks/${BOOK}`, { cadence: "DAILY" });
  assert.equal(find(res.data.board, BOOK).cadence, "DAILY");
  ok("cadence can change and change back");

  res = await call("POST", "/api/tasks", {
    title: "Reading",
    subtext: "",
    cadence: "WEEKLY",
    subtasks: [{ title: "Chapter 1", subtext: "" }, { title: "Chapter 2", subtext: "Notes" }, { title: "Chapter 3", subtext: "" }],
  });
  assert.equal(res.status, 201);
  const reading = res.data.board.tasks.find((t) => t.title === "Reading");
  assert.deepEqual(reading.subtasks.map((s) => s.title), ["Chapter 1", "Chapter 2", "Chapter 3"]);
  ok("creating a task keeps its subtasks in order");

  for (const [body, message] of [
    [{ title: "", cadence: "DAILY" }, "A title is required"],
    [{ title: "x", cadence: "hourly" }, "Cadence must be daily, weekly, monthly or yearly"],
    [{ title: "x".repeat(81), cadence: "DAILY" }, "Title can be at most 80 characters"],
  ]) {
    res = await call("POST", "/api/tasks", body);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, message);
  }
  res = await call("PATCH", `/api/tasks/${BOOK}`, {});
  assert.equal(res.data.error, "Nothing to change");
  res = await call("PUT", `/api/tasks/${BOOK}/done`, { done: "yes" });
  assert.equal(res.status, 400);
  ok("invalid input is rejected with a 400 and a readable message");

  for (const path of ["/api/tasks/not-a-uuid/done", "/api/tasks/00000000-0000-4000-8000-000000000000/done", `/api/subtasks/${FRENCH}/done`]) {
    res = await call("PUT", path, { done: true });
    assert.equal(res.status, 404, path);
  }
  ok("unknown ids answer 404");

  res = await call("DELETE", `/api/tasks/${reading.id}`);
  assert.equal(res.data.board.tasks.some((t) => t.id === reading.id), false);
  res = await call("DELETE", `/api/tasks/${reading.id}`);
  assert.equal(res.status, 404);
  ok("deleting archives the task, and a second delete is a 404");

  // Assistant
  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }], note: null });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { reply: "Hello there.", feedback: [], errors: [], board: null });
  const prompt = api.llm.lastRequest().messages[0].content;
  assert.match(prompt, /^T1 French learning \(daily, not done\)$/m);
  assert.match(prompt, /^ {2}T1\.1 Prepositions — Transcribe and learn French prepositions \(not done\)$/m);
  assert.match(prompt, /^T2 Book Continuation — Write 3 optimized pages today \(daily, not done\)$/m);
  assert.match(prompt, /ACTIONS:/);
  assert.match(prompt, /No note is currently in focus\./);
  ok("a plain question changes nothing, and the prompt lists tasks under refs");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "prepositions are done" }] });
  assert.equal(res.data.reply, "Nice work — prepositions are done for today.");
  assert.deepEqual(res.data.feedback.map((f) => f.kind), ["changed", "completed"]);
  assert.equal(find(res.data.board, FRENCH).done, true);
  ok("voice: completing a subtask by ref strips the ACTIONS line and completes the task");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "add a reading task" }] });
  assert.equal(res.data.reply, "Added a weekly reading task with two chapters.");
  const readingByVoice = res.data.board.tasks.find((t) => t.title === "Reading" && t.cadence === "WEEKLY");
  assert.deepEqual(readingByVoice.subtasks.map((s) => [s.title, s.subtext]), [["Chapter 1", ""], ["Chapter 2", "Take notes"]]);
  ok("voice: create_task inside a code fence works and the fence is removed from the reply");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "rename the book task" }] });
  assert.equal(find(res.data.board, BOOK).title, "Book continuation");
  assert.equal(find(res.data.board, BOOK).subtext, "Write 3 pages today");
  ok("voice: update renames a task");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "add verbs to french" }] });
  french = find(res.data.board, FRENCH);
  assert.deepEqual(french.subtasks.map((s) => s.title), ["Prepositions", "Verbs"]);
  assert.equal(french.done, false);
  ok("voice: add_subtask adds under the right task and reopens it");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "remove verbs" }] });
  french = find(res.data.board, FRENCH);
  assert.deepEqual(french.subtasks.map((s) => s.title), ["Prepositions"]);
  assert.equal(french.done, true);
  ok("voice: delete removes a subtask by ref, completing the task again");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "everything is done" }] });
  assert.equal(find(res.data.board, APP).done, true);
  assert.equal(res.data.errors.length, 2);
  assert.deepEqual(res.data.errors, [
    "Couldn't find the task or subtask it meant",
    'Unknown task operation "explode"',
  ]);
  ok("voice: valid actions apply while bad refs and unknown operations are reported");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "garbled" }] });
  assert.deepEqual(res.data, { reply: "Sure.", feedback: [], errors: ["The assistant's task changes couldn't be read"], board: null });
  ok("voice: an unreadable ACTIONS line is reported, not applied");

  res = await call("POST", "/api/chat", { messages: "nope" });
  assert.equal(res.status, 400);
  ok("chat rejects a malformed history");
});
