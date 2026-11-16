// One-time tasks beside repeating ones: what counts as done, what carries over to the next
// period, and what the assistant is told about them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("one_time");
await api.seedTasks();
const { call, sql } = api;

const find = (board, title) => board.tasks.find((task) => task.title === title);
// Pretend a day has passed: move every done mark of a task into the previous period.
const ageMarks = async (taskId) => {
  await sql(`UPDATE task_completions SET period_index = period_index - 1 WHERE task_id = '${taskId}'`);
  await sql(`UPDATE subtask_completions SET period_index = period_index - 1 WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = '${taskId}')`);
};

test("one-time tasks: done once, carried over until then, cleared as a whole", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/tasks");
  // Missions made by test imports are one-time by design; every other existing task repeats.
  assert.ok(res.data.tasks.filter((task) => !task.title.startsWith("Tests · ")).every((task) => task.repeats === true));
  ok("existing tasks are repeating by default");

  res = await call("POST", "/api/tasks", { title: "Renew passport", subtext: "", cadence: "DAILY", repeats: false, subtasks: [] });
  assert.equal(res.status, 201);
  let passport = find(res.data.board, "Renew passport");
  assert.equal(passport.repeats, false);
  assert.equal(passport.done, false);
  assert.equal(passport.streak, 0);
  ok("a one-time task can be created");

  res = await call("PUT", `/api/tasks/${passport.id}/done`, { done: true });
  assert.equal(find(res.data.board, "Renew passport").done, true);
  assert.equal(res.data.feedback[0]?.kind, "completed");
  ok("ticking it marks it done, with the usual pop-up");

  await ageMarks(passport.id);
  res = await call("GET", "/api/tasks");
  assert.equal(find(res.data, "Renew passport"), undefined);
  ok("after the period it was finished in, a done one-time task leaves the list");

  res = await call("POST", "/api/tasks", { title: "Stays open", subtext: "", cadence: "DAILY", repeats: false });
  const open = find(res.data.board, "Stays open");
  await sql(`UPDATE tasks SET created_at = now() - interval '3 days' WHERE id = '${open.id}'`);
  res = await call("GET", "/api/tasks");
  assert.equal(find(res.data, "Stays open").done, false);
  ok("an unfinished one-time task carries over until it's done");

  const french = find(res.data, "French learning");
  await call("PUT", `/api/tasks/${french.id}/done`, { done: true });
  await ageMarks(french.id);
  res = await call("GET", "/api/tasks");
  assert.equal(find(res.data, "French learning").done, false);
  assert.equal(find(res.data, "French learning").streak, 1);
  ok("a repeating task still starts undone in the next period, keeping its streak");

  res = await call("POST", "/api/tasks", {
    title: "Move house",
    subtext: "",
    cadence: "WEEKLY",
    repeats: false,
    subtasks: [{ title: "Pack", subtext: "" }, { title: "Book the van", subtext: "" }],
  });
  let move = find(res.data.board, "Move house");
  const [pack, van] = move.subtasks;
  await call("PUT", `/api/subtasks/${pack.id}/done`, { done: true });
  await sql(`UPDATE subtask_completions SET period_index = period_index - 1 WHERE subtask_id = '${pack.id}'`);
  res = await call("GET", "/api/tasks");
  move = find(res.data, "Move house");
  assert.equal(move.subtasks.find((s) => s.id === pack.id).done, true);
  assert.equal(move.done, false);
  ok("a one-time task's ticked subtask stays ticked into the next period");

  res = await call("PUT", `/api/subtasks/${van.id}/done`, { done: true });
  move = find(res.data.board, "Move house");
  assert.equal(move.done, true);
  assert.equal(res.data.feedback.at(-1)?.kind, "completed");
  ok("ticking the last subtask completes it, counting a subtask ticked in an earlier period");

  res = await call("PUT", `/api/tasks/${move.id}/done`, { done: false });
  move = find(res.data.board, "Move house");
  assert.equal(move.done, false);
  assert.ok(move.subtasks.every((s) => !s.done));
  assert.equal(await sql(`SELECT count(*) FROM subtask_completions WHERE subtask_id IN ('${pack.id}', '${van.id}')`), "0");
  ok("reopening a one-time task clears every mark, from any period");

  res = await call("PATCH", `/api/tasks/${open.id}`, { repeats: true });
  assert.equal(find(res.data.board, "Stays open").repeats, true);
  res = await call("PUT", `/api/tasks/${open.id}/done`, { done: true });
  res = await call("PATCH", `/api/tasks/${open.id}`, { repeats: false });
  assert.equal(find(res.data.board, "Stays open").done, true);
  ok("the kind can be switched either way, and a task done today stays done");

  res = await call("POST", "/api/tasks", { title: "Bad", cadence: "DAILY", repeats: "no" });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "repeats must be true (repeating) or false (one-time)");
  ok("a kind that isn't true or false is refused with a clear message");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }] });
  const prompt = api.llm.lastRequest().messages[0].content;
  assert.match(prompt, /Stays open \(one-time, in the daily list, done\)/);
  assert.match(prompt, /French learning \(daily, not done\)/);
  assert.match(prompt, /"repeats":false|repeats: false/);
  ok("the assistant is told which tasks are one-time, and how to create one");
});
