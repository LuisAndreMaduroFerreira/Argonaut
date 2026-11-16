// Tests imported from JSON: what a file may look like, how a broken one is refused, attempts
// and their scores, and deletion.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("tests");
const { call, base } = api;
const sample = JSON.parse(readFileSync(new URL("../../documentation/sample-test.json", import.meta.url), "utf8"));

test("tests: import, the checks on a file, attempts and deletion", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/tests");
  assert.deepEqual(res.data, []);
  ok("no tests at first");

  res = await call("POST", "/api/tests/import", sample);
  assert.equal(res.status, 201);
  assert.equal(res.data.imported, 1);
  assert.equal(res.data.questions, 8);
  const [summary] = res.data.tests;
  assert.equal(summary.title, "French prepositions of place");
  assert.equal(summary.questionCount, 8);
  assert.equal(summary.openCount, 3);
  assert.equal(summary.attempts, 0);
  assert.equal(summary.last, null);
  ok("the sample imports: 8 questions, 5 multiple choice and 3 open");

  res = await call("GET", `/api/tests/${summary.id}`);
  assert.equal(res.data.shuffleOptions, true);
  assert.equal(res.data.shuffleQuestions, false);
  assert.deepEqual(res.data.questions[3], {
    type: "choice",
    question: "Which of these say where something is? Choose all that apply.",
    options: ["devant", "avec", "derrière", "pour"],
    answer: ["devant", "derrière"],
    explanation: "Devant is in front of and derrière is behind. Avec (with) and pour (for) don't give a place.",
  });
  assert.deepEqual(res.data.questions[5].answer, ["à"]);
  assert.equal(res.data.questions[7].explanation, "");
  ok("questions are stored normalized: type inferred, answers always a list");

  res = await call("POST", "/api/tests/import", [
    { title: "Numbers", shuffle_questions: true, questions: [{ question: "2 + 2", options: [3, 4, 5], answer: 4 }] },
    { name: "Aliases", questions: [{ type: "multiple_choice", prompt: "Pick b", options: ["A", "B"], answers: "b" }, { type: "open_answer", question: "Say hi", answer: "hi" }] },
  ]);
  assert.equal(res.status, 201);
  assert.equal(res.data.imported, 2);
  const numbers = res.data.tests.find((t) => t.title === "Numbers");
  const detail = (await call("GET", `/api/tests/${numbers.id}`)).data;
  assert.deepEqual(detail.questions[0].options, ["3", "4", "5"]);
  assert.equal(detail.shuffleQuestions, true);
  const aliases = (await call("GET", `/api/tests/${res.data.tests.find((t) => t.title === "Aliases").id}`)).data;
  assert.deepEqual(aliases.questions[0].answer, ["B"]);
  ok("a list of tests imports; numbers, 'name', 'prompt', 'answers' and type aliases are understood");

  res = await call("POST", "/api/tests/import", {
    title: "Broken",
    questions: [
      { question: "Where?", options: ["sur", "sous"], answer: "dans" },
      { question: "Open with options", type: "open", options: ["a", "b"], answer: "a" },
      { question: "", answer: "x" },
      { question: "Only one option", options: ["a"], answer: "a" },
      { question: "Same options", options: ["a", "A"], answer: "a" },
      { question: "No answer", options: ["a", "b"] },
      { question: "Bad type", type: "essay", answer: "x" },
    ],
  });
  assert.equal(res.status, 400);
  const lines = res.data.error.split("\n");
  assert.equal(lines.length, 6);
  assert.equal(lines[0], 'Test "Broken", question 1: the answer "dans" isn\'t one of the options (use the option\'s text)');
  assert.equal(lines[1], 'Test "Broken", question 2: an open question can\'t have options');
  assert.equal(lines[2], 'Test "Broken", question 3: "question" is empty');
  assert.equal(lines[5], "…and 2 more");
  ok("a broken file is refused as a whole, listing the first 5 problems by test and question");

  for (const [body, expected] of [
    [{ questions: [] }, 'Test: "title" is missing'],
    [{ title: "No questions", questions: [] }, 'Test "No questions": "questions" must be a list with at least one question'],
    [{ title: "Bad flag", shuffle_options: "yes", questions: [{ question: "q", answer: "a" }] }, 'Test "Bad flag": "shuffle_options" must be true or false'],
    [[], "The file has no tests in it"],
    ["just text", "Test must be an object with \"title\" and \"questions\""],
  ]) {
    res = await call("POST", "/api/tests/import", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.data.error, expected);
  }
  const raw = await fetch(`${base}/api/tests/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{ "title": "Half written", ',
  });
  assert.equal(raw.status, 400);
  assert.equal((await raw.json()).error, "The request body isn't valid JSON");
  res = await call("GET", "/api/tests");
  assert.equal(res.data.length, 3);
  ok("unreadable JSON is a 400 with a plain message, and nothing from a refused file is stored");

  const responses = Array.from({ length: 8 }, (_, question) => ({ question, given: "x", correct: question < 6 }));
  res = await call("POST", `/api/tests/${summary.id}/attempts`, { responses });
  assert.equal(res.status, 201);
  assert.equal(res.data.update, null);
  let stats = res.data.tests.find((t) => t.id === summary.id);
  assert.equal(stats.attempts, 1);
  assert.equal(stats.last.score, 6);
  assert.equal(stats.last.total, 8);
  assert.equal(stats.bestPercent, 75);
  res = await call("POST", `/api/tests/${summary.id}/attempts`, {
    responses: responses.map((r) => ({ ...r, given: ["devant", "derrière"], correct: r.question < 4 })),
  });
  stats = res.data.tests.find((t) => t.id === summary.id);
  assert.equal(stats.attempts, 2);
  assert.equal(stats.last.score, 4);
  assert.equal(stats.bestPercent, 75);
  ok("attempts are kept: last score 4/8, best stays 75%");

  for (const body of [
    { responses: responses.slice(0, 7) },
    { responses: responses.map((r) => ({ ...r, question: 0 })) },
    { responses: responses.map((r) => ({ ...r, correct: "yes" })) },
    { responses: responses.map((r) => ({ ...r, question: r.question + 1 })) },
  ]) {
    res = await call("POST", `/api/tests/${summary.id}/attempts`, body);
    assert.equal(res.status, 400);
  }
  ok("malformed attempts are refused");

  res = await call("DELETE", `/api/tests/${summary.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.some((t) => t.id === summary.id), false);
  assert.equal((await call("GET", `/api/tests/${summary.id}`)).status, 404);
  assert.equal((await call("POST", `/api/tests/${summary.id}/attempts`, { responses })).status, 404);
  ok("deleting archives the test; it can't be opened or scored afterwards");
});
