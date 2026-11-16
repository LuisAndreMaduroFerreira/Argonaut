// Grading typed and chosen answers: what counts, what's a near miss, what's wrong.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeChoice, gradeOpen, normalizeAnswer, shuffled } from "./grading";

test("à: exact and case-insensitive count; a missing accent is a near miss; another word is wrong", () => {
  assert.equal(gradeOpen(["à"], "à"), "correct");
  assert.equal(gradeOpen(["à"], " À "), "correct");
  assert.equal(gradeOpen(["à"], "a"), "accents");
  assert.equal(gradeOpen(["à"], "de"), "wrong");
});

test("sentences: spacing, capitals and final punctuation don't matter; accents and words do", () => {
  const sentence = ["Le livre est entre la lampe et le téléphone"];
  assert.equal(gradeOpen(sentence, "le livre est entre la lampe et le téléphone."), "correct");
  assert.equal(gradeOpen(sentence, "Le  livre est entre la lampe  et le téléphone !"), "correct");
  assert.equal(gradeOpen(sentence, "Le livre est entre la lampe et le telephone"), "accents");
  assert.equal(gradeOpen(sentence, "Le livre est sur la lampe et le téléphone"), "wrong");
});

test("curly apostrophes, guillemets, several accepted answers and composed/decomposed accents are handled", () => {
  assert.equal(gradeOpen(["aujourd'hui"], "aujourd\u2019hui"), "correct");
  assert.equal(gradeOpen(["« derrière »"], "derrière"), "correct");
  assert.equal(gradeOpen(["behind", "at the back"], "At the back"), "correct");
  assert.equal(normalizeAnswer("e\u0301te\u0301"), normalizeAnswer("\u00e9t\u00e9"));
});

test("choose-all questions need exactly the right set, in any order", () => {
  assert.equal(gradeChoice(["sur"], ["sur"]), "correct");
  assert.equal(gradeChoice(["sur"], ["sous"]), "wrong");
  assert.equal(gradeChoice(["devant", "derrière"], ["derrière", "devant"]), "correct");
  assert.equal(gradeChoice(["devant", "derrière"], ["devant"]), "wrong");
  assert.equal(gradeChoice(["devant", "derrière"], ["devant", "derrière", "avec"]), "wrong");
});

test("shuffling keeps every option and leaves the original order alone", () => {
  const items = [1, 2, 3, 4, 5, 6];
  const mixed = shuffled(items);
  assert.deepEqual([...mixed].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6]);
});
