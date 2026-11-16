// Folders in the Tests section and the weekly mission each import brings: one subtask per
// test, ticked by a pass at 100%.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("test_folders");
const { call, sql } = api;
const rustFile = new URL("../../documentation/rust-principal-engineer-tests.json", import.meta.url);

const mission = (board, title) => board.tasks.find((task) => task.title === title);
const choice = (question, answer, wrong) => ({ question, options: [answer, ...wrong], answer });
const open = (question, answer) => ({ question, answer });
const pass = (count) => ({ responses: Array.from({ length: count }, (_, question) => ({ question, given: "x", correct: true })) });
const fail = (count) => ({
  responses: Array.from({ length: count }, (_, question) => ({ question, given: "x", correct: question !== 0 })),
});

const batch = {
  name: "Rust",
  tests: [
    { title: "Ownership", questions: [choice("Is String Copy?", "No", ["Yes"]), open("Trait for implicit copies?", "Copy")] },
    { title: "Borrowing", questions: [choice("How many &mut at once?", "One", ["Two", "Any"])] },
    { title: "Lifetimes", questions: [open("Lifetime of string literals?", ["'static", "static"])] },
  ],
};

test("test folders: a folder and a weekly mission for each import", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/tests");
  assert.deepEqual(res.data, []);
  res = await call("GET", "/api/test-folders");
  assert.deepEqual(res.data, []);
  ok("the test database starts empty");

  res = await call("POST", "/api/tests/import", batch);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.imported, 3);
  assert.equal(res.data.questions, 4);
  assert.equal(res.data.folder.name, "Rust");
  assert.equal(res.data.mission, "Tests · Rust");
  const rust = res.data.folder;
  assert.deepEqual(res.data.folders, [{ id: rust.id, name: "Rust" }]);
  assert.equal(res.data.tests.length, 3);
  assert.ok(res.data.tests.every((test) => test.folderId === rust.id));
  ok("a named batch goes into a folder with that name, and the response carries tests and folders");

  let task = mission(res.data.board, "Tests · Rust");
  assert.ok(task, "the mission is on the board");
  assert.equal(task.cadence, "WEEKLY");
  assert.equal(task.repeats, false);
  assert.equal(task.done, false);
  assert.deepEqual(
    task.subtasks.map((subtask) => [subtask.title, subtask.subtext, subtask.done]),
    [
      ["Ownership", "2 questions", false],
      ["Borrowing", "1 question", false],
      ["Lifetimes", "1 question", false],
    ],
  );
  assert.match(task.subtext, /100%/);
  ok("the import adds a one-time weekly mission with a subtask per test, in file order");

  const links = (
    await sql(
      `SELECT t.title || '=' || s.title FROM tests t JOIN subtasks s ON s.id = t.subtask_id WHERE t.folder_id = '${rust.id}' ORDER BY t.created_at`,
    )
  ).split("\n");
  assert.deepEqual(links, ["Ownership=Ownership", "Borrowing=Borrowing", "Lifetimes=Lifetimes"]);
  ok("each test is linked to its own subtask");

  res = await call("POST", "/api/tests/import", batch);
  assert.equal(res.status, 201);
  assert.equal(res.data.folder.name, "Rust 2");
  assert.equal(res.data.mission, "Tests · Rust 2");
  const rust2 = res.data.folder;
  assert.equal(res.data.folders.length, 2);
  ok("importing the same file again gets a folder and mission of its own");

  res = await call("POST", "/api/tests/import", { title: "Solo test", questions: [open("One?", "1")] });
  assert.equal(res.data.folder.name, "Solo test");
  assert.equal(res.data.mission, "Tests · Solo test");
  const solo = res.data.folder;
  res = await call("POST", "/api/tests/import", [{ title: "Listed", questions: [open("Two?", "2")] }, { title: "Also listed", questions: [open("Three?", "3")] }]);
  assert.match(res.data.folder.name, /^Imported \d{4}-\d{2}-\d{2}$/);
  ok("without a name, a single test lends its title and a list is named for the day");

  for (const [name, pattern] of [
    ["", /name/],
    ["x".repeat(81), /longer than 80/],
    [["Rust"], /must be text/],
  ]) {
    res = await call("POST", "/api/tests/import", { name, tests: batch.tests });
    assert.equal(res.status, 400, `name ${JSON.stringify(name)}`);
    assert.match(res.data.error, pattern);
  }
  res = await call("GET", "/api/test-folders");
  assert.equal(res.data.length, 4);
  ok("an empty, too long or non-text name is refused, and nothing is created");

  const tests = (await call("GET", "/api/tests")).data.filter((test) => test.folderId === rust.id);
  const [ownership, borrowing, lifetimes] = tests;
  res = await call("POST", `/api/tests/${ownership.id}/attempts`, fail(2));
  assert.equal(res.status, 201);
  assert.equal(res.data.update, null);
  assert.equal(mission((await call("GET", "/api/tasks")).data, "Tests · Rust").subtasks[0].done, false);
  ok("a run below 100% records the score but leaves the subtask open");

  res = await call("POST", `/api/tests/${borrowing.id}/attempts`, pass(1));
  assert.equal(res.status, 201);
  assert.deepEqual(res.data.update.feedback, [{ kind: "changed", action: "Passed at 100% · subtask ticked", title: "Borrowing" }]);
  task = mission(res.data.update.board, "Tests · Rust");
  assert.deepEqual(task.subtasks.map((subtask) => subtask.done), [false, true, false]);
  assert.equal(task.done, false);
  assert.equal(res.data.tests.find((test) => test.id === borrowing.id).bestPercent, 100);
  ok("a 100% run ticks that test's subtask and says so");

  res = await call("POST", `/api/tests/${borrowing.id}/attempts`, pass(1));
  assert.equal(res.data.update, null);
  assert.equal(await sql(`SELECT count(*) FROM subtask_completions WHERE subtask_id = (SELECT subtask_id FROM tests WHERE id = '${borrowing.id}')`), "1");
  ok("passing it again changes nothing and adds no second tick");

  res = await call("POST", `/api/tests/${ownership.id}/attempts`, pass(2));
  assert.equal(res.data.update.feedback.length, 1);
  res = await call("POST", `/api/tests/${lifetimes.id}/attempts`, pass(1));
  const feedback = res.data.update.feedback;
  assert.equal(feedback[0].action, "Passed at 100% · subtask ticked");
  assert.equal(feedback[1]?.kind, "completed");
  assert.equal(feedback[1]?.title, "Tests · Rust");
  task = mission(res.data.update.board, "Tests · Rust");
  assert.equal(task.done, true);
  assert.ok(task.subtasks.every((subtask) => subtask.done));
  ok("passing the last test completes the mission, with the usual pop-up");

  // Rust 2: pass two, then delete the third; the mission is then complete.
  const second = (await call("GET", "/api/tests")).data.filter((test) => test.folderId === rust2.id);
  await call("POST", `/api/tests/${second[0].id}/attempts`, pass(2));
  await call("POST", `/api/tests/${second[1].id}/attempts`, pass(1));
  res = await call("DELETE", `/api/tests/${second[2].id}`);
  assert.equal(res.status, 200);
  assert.ok(!res.data.some((test) => test.id === second[2].id));
  task = mission((await call("GET", "/api/tasks")).data, "Tests · Rust 2");
  assert.deepEqual(task.subtasks.map((subtask) => subtask.title), ["Ownership", "Borrowing"]);
  assert.equal(task.done, true);
  ok("deleting a test removes its subtask; deleting the last open one finishes the mission");

  res = await call("POST", "/api/tests/import", {
    name: "Throwaway",
    tests: [{ title: "T1", questions: [open("a?", "a")] }, { title: "T2", questions: [open("b?", "b")] }],
  });
  const throwaway = res.data.tests.filter((test) => test.folderId === res.data.folder.id);
  await call("DELETE", `/api/tests/${throwaway[0].id}`);
  assert.ok(mission((await call("GET", "/api/tasks")).data, "Tests · Throwaway"), "one test left, so the mission stays");
  await call("DELETE", `/api/tests/${throwaway[1].id}`);
  assert.equal(mission((await call("GET", "/api/tasks")).data, "Tests · Throwaway"), undefined);
  ok("deleting every test of an import takes its emptied mission away too");

  res = await call("PATCH", `/api/test-folders/${rust.id}`, { name: "Rust basics" });
  assert.equal(res.status, 200);
  assert.equal(res.data.find((folder) => folder.id === rust.id).name, "Rust basics");
  res = await call("PATCH", `/api/test-folders/${rust.id}`, { name: "rust 2" });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /already a folder/);
  res = await call("PATCH", `/api/test-folders/${rust.id}`, { name: "  " });
  assert.equal(res.status, 400);
  res = await call("PATCH", "/api/test-folders/00000000-0000-4000-8000-000000000000", { name: "Nope" });
  assert.equal(res.status, 404);
  res = await call("PATCH", `/api/test-folders/${rust.id}`, { name: "RUST BASICS" });
  assert.equal(res.status, 200);
  ok("folders can be renamed, not onto another folder's name; a change of case is fine");

  res = await call("DELETE", `/api/test-folders/${solo.id}`);
  assert.equal(res.status, 200);
  assert.ok(!res.data.folders.some((folder) => folder.id === solo.id));
  const loose = res.data.tests.find((test) => test.title === "Solo test");
  assert.equal(loose.folderId, null);
  assert.ok(mission((await call("GET", "/api/tasks")).data, "Tests · Solo test"), "the mission stays");
  res = await call("DELETE", `/api/test-folders/${solo.id}`);
  assert.equal(res.status, 404);
  ok("deleting a folder keeps its tests (out of any folder) and their mission");

  res = await call("POST", `/api/tests/${loose.id}/attempts`, pass(1));
  assert.equal(res.data.update.feedback[1]?.kind, "completed");
  ok("a test outside any folder still ticks its mission");

  res = await call("POST", "/api/tests/generate", {
    notes: [{ title: "Skills", content: "Metadata loads first; full instructions load when needed." }],
    count: 4,
    source: "Agents",
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const generated = res.data.tests.find((test) => test.id === res.data.id);
  assert.equal(generated.folderId, null);
  assert.equal(await sql(`SELECT subtask_id IS NULL FROM tests WHERE id = '${res.data.id}'`), "t");
  res = await call("POST", `/api/tests/${generated.id}/attempts`, pass(generated.questionCount));
  assert.equal(res.data.update, null);
  ok("a generated test has no folder and no mission, and passing it ticks nothing");

  const many = Array.from({ length: 25 }, (_, index) => ({ title: `Drill ${index + 1}`, questions: [open(`Q${index + 1}?`, "a")] }));
  res = await call("POST", "/api/tests/import", { name: "Drills", tests: many });
  assert.equal(res.status, 201);
  assert.equal(mission(res.data.board, "Tests · Drills").subtasks.length, 25);
  ok("an import may hold more tests than the 20-subtask limit of hand-made tasks");

  res = await call("PATCH", "/api/state/preferences", { collapsedSections: ["notes", "tests"] });
  assert.equal(res.status, 204);
  res = await call("GET", "/api/state");
  assert.deepEqual(res.data.preferences.collapsedSections, ["notes", "tests"]);
  res = await call("PATCH", "/api/state/preferences", { collapsedSections: ["tests", "quizzes"] });
  assert.equal(res.status, 400);
  ok("the Tests section's closed state is remembered, and unknown sections are refused");

  const file = JSON.parse(readFileSync(rustFile, "utf8"));
  const total = file.tests.reduce((sum, test) => sum + test.questions.length, 0);
  res = await call("POST", "/api/tests/import", file);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.imported, 50);
  assert.equal(res.data.questions, total);
  assert.equal(res.data.folder.name, "Rust — principal engineer");
  task = mission(res.data.board, "Tests · Rust — principal engineer");
  assert.equal(task.subtasks.length, 50);
  assert.equal(task.subtasks[0].title, "01 · Ownership and moves");
  assert.equal(task.subtasks[49].title, "50 · Bridges to C++, Python and JavaScript");
  assert.ok(task.subtasks.every((subtask, index) => subtask.subtext === `${file.tests[index].questions.length} questions`));
  ok(`the Rust batch imports whole: 50 tests, ${total} questions, one folder, a 50-subtask mission`);

  const imported = res.data.tests.filter((test) => test.folderId === res.data.folder.id);
  let checked = 0;
  for (const [index, summary] of imported.entries()) {
    const full = (await call("GET", `/api/tests/${summary.id}`)).data;
    const source = file.tests[index];
    assert.equal(full.title, source.title);
    assert.equal(full.questions.length, source.questions.length);
    full.questions.forEach((question, qi) => {
      const expected = source.questions[qi];
      assert.equal(question.question, expected.question);
      assert.equal(question.type, expected.options ? "choice" : "open");
      if (expected.options) assert.deepEqual(question.options, expected.options);
      assert.deepEqual(question.answer, Array.isArray(expected.answer) ? expected.answer : [expected.answer]);
      checked += 1;
    });
  }
  assert.equal(checked, total);
  const fenced = file.tests.flatMap((test) => test.questions).filter((question) => question.question.includes("```rust")).length;
  ok(`every stored question matches the file (${fenced} of them carry a Rust code block)`);
});
