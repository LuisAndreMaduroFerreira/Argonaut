import type { PoolClient } from "pg";
import {
  LIMITS as SHARED_LIMITS,
  type TaskFeedback,
  type TestDetail,
  type TestFolder,
  type TestQuestion,
  type TestSummary,
} from "../../shared/model.js";
import { pool, withTransaction } from "./db.js";
import { InputError } from "./errors.js";
import { isObject, isUuid, readLine } from "./input.js";
import { archiveSubtask, archiveTask, completeSubtask, createTask } from "./tasks.js";

// Tests are written (or generated) as JSON and imported whole. The format is forgiving where
// it costs nothing — "type" can be left out, "answer" may be one value or a list — and strict
// where a mistake would make a question ungradable.

const LIMITS = {
  tests: 60,
  batchName: SHARED_LIMITS.folderName,
  questions: 200,
  options: 10,
  accepted: 20,
  title: 120,
  description: 500,
  question: 1000,
  answer: 300,
  explanation: 1000,
  errorsShown: 5,
} as const;

// A test as it is written: what an import file or the assistant gives, once checked.
export type TestDraft = Omit<TestDetail, "id">;

const CHOICE_TYPES = new Set(["choice", "multiple_choice", "multiple-choice", "multiplechoice", "mcq"]);
const OPEN_TYPES = new Set(["open", "open_answer", "open-answer", "text", "short_answer"]);

// A field of a test file. Unlike a single-line name (readLine), its text keeps its line
// breaks, so a question can show code, and numbers are accepted as text, so maths answers can
// be written as 42 rather than "42". `where` says which test and question it belongs to.
function readField(value: unknown, where: string, name: string, max: number, required = true): string {
  if (value === undefined || value === null) {
    if (required) throw new InputError(`${where}: "${name}" is missing`);
    return "";
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new InputError(`${where}: "${name}" must be text`);
  }
  const text = String(value).trim();
  if (required && text.length === 0) throw new InputError(`${where}: "${name}" is empty`);
  if (text.length > max) throw new InputError(`${where}: "${name}" is longer than ${max} characters`);
  return text;
}

function readAnswers(value: unknown, where: string, maxItems: number): string[] {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) throw new InputError(`${where}: "answer" is empty`);
  if (items.length > maxItems) throw new InputError(`${where}: "answer" lists more than ${maxItems} values`);
  return items.map((item) => readField(item, where, "answer", LIMITS.answer));
}

function readFlag(value: unknown, where: string, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new InputError(`${where}: "${name}" must be true or false`);
  return value;
}

function parseQuestion(raw: unknown, where: string): TestQuestion {
  if (!isObject(raw)) throw new InputError(`${where} must be an object`);
  const question = readField(raw.question ?? raw.prompt, where, "question", LIMITS.question);
  const explanation = readField(raw.explanation, where, "explanation", LIMITS.explanation, false);
  const answerValue = raw.answer ?? raw.answers;
  if (answerValue === undefined) throw new InputError(`${where}: "answer" is missing`);

  const declared = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : undefined;
  if (declared !== undefined && !CHOICE_TYPES.has(declared) && !OPEN_TYPES.has(declared)) {
    throw new InputError(`${where}: unknown type "${String(raw.type)}" (use "choice" or "open")`);
  }
  const isChoice = declared !== undefined ? CHOICE_TYPES.has(declared) : raw.options !== undefined;

  if (!isChoice) {
    if (raw.options !== undefined) throw new InputError(`${where}: an open question can't have options`);
    const accepted = [...new Set(readAnswers(answerValue, where, LIMITS.accepted))];
    return { type: "open", question, answer: accepted, explanation };
  }

  if (!Array.isArray(raw.options)) throw new InputError(`${where}: "options" must be a list`);
  if (raw.options.length < 2 || raw.options.length > LIMITS.options) {
    throw new InputError(`${where}: give between 2 and ${LIMITS.options} options`);
  }
  const options = raw.options.map((option, index) => readField(option, where, `option ${index + 1}`, LIMITS.answer));
  const lowered = options.map((option) => option.toLowerCase());
  if (new Set(lowered).size !== options.length) throw new InputError(`${where}: two options are the same`);

  const correct = readAnswers(answerValue, where, LIMITS.options).map((answer) => {
    const index = lowered.indexOf(answer.toLowerCase());
    if (index === -1) {
      throw new InputError(`${where}: the answer "${answer}" isn't one of the options (use the option's text)`);
    }
    return options[index]!;
  });
  return { type: "choice", question, options, answer: [...new Set(correct)], explanation };
}

function parseTest(raw: unknown, where: string, errors: string[]): TestDraft | null {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object with "title" and "questions"`);
    return null;
  }
  try {
    const title = readField(raw.title ?? raw.name, where, "title", LIMITS.title);
    const label = `${where} "${title}"`;
    const description = readField(raw.description, label, "description", LIMITS.description, false);
    const shuffleOptions = readFlag(raw.shuffle_options, label, "shuffle_options", true);
    const shuffleQuestions = readFlag(raw.shuffle_questions, label, "shuffle_questions", false);
    if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
      throw new InputError(`${label}: "questions" must be a list with at least one question`);
    }
    if (raw.questions.length > LIMITS.questions) {
      throw new InputError(`${label}: more than ${LIMITS.questions} questions`);
    }

    // Collect every broken question, so one import round shows all that needs fixing.
    const questions: TestQuestion[] = [];
    raw.questions.forEach((question, index) => {
      try {
        questions.push(parseQuestion(question, `${label}, question ${index + 1}`));
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        errors.push(error.message);
      }
    });
    return { title, description, shuffleOptions, shuffleQuestions, questions };
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    errors.push(error.message);
    return null;
  }
}

// A file holds one test, a list of tests, or { "tests": [...] }.
export function parseTestImport(body: unknown): TestDraft[] {
  const list: unknown[] = Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body.tests)
      ? body.tests
      : [body];
  if (list.length === 0) throw new InputError("The file has no tests in it");
  if (list.length > LIMITS.tests) throw new InputError(`A file can hold at most ${LIMITS.tests} tests`);

  const errors: string[] = [];
  const drafts = list.map((raw, index) => parseTest(raw, list.length > 1 ? `Test ${index + 1}` : "Test", errors));
  if (errors.length > 0) {
    const shown = errors.slice(0, LIMITS.errorsShown);
    const more = errors.length - shown.length;
    throw new InputError([...shown, ...(more > 0 ? [`…and ${more} more`] : [])].join("\n"));
  }
  return drafts as TestDraft[];
}

// A file's tests with the name it gives the batch: { "name": …, "tests": [...] }. Without a
// name, a single test lends its title and a list is named for the day it came in.
export function parseImportBatch(body: unknown): { name: string | null; drafts: TestDraft[] } {
  const drafts = parseTestImport(body);
  const raw = isObject(body) && Array.isArray(body.tests) ? body.name : undefined;
  const name = raw === undefined ? null : readField(raw, "The file", "name", LIMITS.batchName);
  return { name, drafts };
}

// Returns the new tests' ids, in the order given. Imported tests also carry their folder and
// the mission subtask they close; generated ones carry neither.
export async function importTests(
  client: PoolClient,
  drafts: TestDraft[],
  links?: { folderId: string; subtaskIds: string[] },
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, draft] of drafts.entries()) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO tests (title, description, shuffle_options, shuffle_questions, questions, folder_id, subtask_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        draft.title,
        draft.description,
        draft.shuffleOptions,
        draft.shuffleQuestions,
        JSON.stringify(draft.questions),
        links?.folderId ?? null,
        links?.subtaskIds[index] ?? null,
      ],
    );
    ids.push(result.rows[0]!.id);
  }
  return ids;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// "Rust", else "Rust 2", "Rust 3"… so a second import of the same file gets a folder of its own.
async function freeFolderName(client: PoolClient, name: string): Promise<string> {
  const taken = await client.query<{ name: string }>("SELECT lower(name) AS name FROM test_folders");
  const names = new Set(taken.rows.map((row) => row.name));
  if (!names.has(name.toLowerCase())) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${clip(name, LIMITS.batchName - String(n).length - 1)} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

function today(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

// An import is a batch: its tests go into a folder of their own in the sidebar's Tests section,
// and a weekly mission gets a subtask per test, ticked when that test is passed at 100%. The
// mission is one-time, so a test passed once stays ticked while the rest carry over week to week.
export async function importBatch(
  client: PoolClient,
  drafts: TestDraft[],
  name: string | null,
  tz: string,
): Promise<{ folder: { id: string; name: string }; missionTitle: string; ids: string[] }> {
  const base = name ?? (drafts.length === 1 ? drafts[0]!.title : `Imported ${today(tz)}`);
  const folderName = await freeFolderName(client, clip(base, LIMITS.batchName));
  const folder = await client.query<{ id: string }>("INSERT INTO test_folders (name) VALUES ($1) RETURNING id", [
    folderName,
  ]);
  const folderId = folder.rows[0]!.id;

  const missionTitle = clip(`Tests · ${folderName}`, 80);
  const taskId = await createTask(client, {
    title: missionTitle,
    subtext: "Pass each test at 100% in the Tests tab; open answers you count as right are fine.",
    cadence: "WEEKLY",
    repeats: false,
    subtasks: drafts.map((draft) => ({
      title: clip(draft.title, 80),
      subtext: `${draft.questions.length} question${draft.questions.length === 1 ? "" : "s"}`,
    })),
  });
  const subtasks = await client.query<{ id: string }>(
    "SELECT id FROM subtasks WHERE task_id = $1 ORDER BY created_at, id",
    [taskId],
  );
  const ids = await importTests(client, drafts, { folderId, subtaskIds: subtasks.rows.map((row) => row.id) });
  return { folder: { id: folderId, name: folderName }, missionTitle, ids };
}

export async function listTestFolders(): Promise<TestFolder[]> {
  const result = await pool.query<TestFolder>("SELECT id, name FROM test_folders ORDER BY created_at, id");
  return result.rows;
}

export async function renameTestFolder(id: string, body: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const name = readLine(isObject(body) ? body.name : undefined, '"name"', LIMITS.batchName);
  if (name === "") throw new InputError('"name" can\'t be empty');
  const clash = await pool.query("SELECT 1 FROM test_folders WHERE lower(name) = lower($1) AND id <> $2", [name, id]);
  if ((clash.rowCount ?? 0) > 0) throw new InputError(`There's already a folder called “${name}”`);
  const result = await pool.query("UPDATE test_folders SET name = $2 WHERE id = $1", [id, name]);
  return (result.rowCount ?? 0) > 0;
}

// The folder goes; its tests stay, out of any folder, still linked to their mission subtasks.
export async function deleteTestFolder(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return withTransaction(async (client) => {
    await client.query("UPDATE tests SET folder_id = NULL WHERE folder_id = $1", [id]);
    const result = await client.query("DELETE FROM test_folders WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  });
}

interface SummaryRow {
  id: string;
  title: string;
  description: string;
  folder_id: string | null;
  question_count: number;
  open_count: number;
  attempts: number;
  last_attempt: { score: number; total: number; finished_at: string } | null;
  best_percent: number | null;
}

export async function listTests(): Promise<TestSummary[]> {
  const result = await pool.query<SummaryRow>(
    `SELECT t.id, t.title, t.description, t.folder_id,
            jsonb_array_length(t.questions) AS question_count,
            (SELECT count(*)::int FROM jsonb_array_elements(t.questions) q WHERE q->>'type' = 'open') AS open_count,
            (SELECT count(*)::int FROM test_attempts a WHERE a.test_id = t.id) AS attempts,
            (SELECT json_build_object('score', a.score, 'total', a.total, 'finished_at', a.finished_at)
             FROM test_attempts a WHERE a.test_id = t.id
             ORDER BY a.finished_at DESC LIMIT 1) AS last_attempt,
            (SELECT max(round(100.0 * a.score / a.total))::int FROM test_attempts a WHERE a.test_id = t.id) AS best_percent
     FROM tests t
     WHERE t.archived_at IS NULL
     ORDER BY t.created_at, t.id`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    folderId: row.folder_id,
    questionCount: row.question_count,
    openCount: row.open_count,
    attempts: row.attempts,
    last: row.last_attempt
      ? {
          score: row.last_attempt.score,
          total: row.last_attempt.total,
          finishedAt: new Date(row.last_attempt.finished_at).toISOString(),
        }
      : null,
    bestPercent: row.best_percent,
  }));
}

export async function getTest(id: string): Promise<TestDetail | null> {
  if (!isUuid(id)) return null;
  const result = await pool.query<{
    id: string;
    title: string;
    description: string;
    shuffle_options: boolean;
    shuffle_questions: boolean;
    questions: TestQuestion[];
  }>(
    `SELECT id, title, description, shuffle_options, shuffle_questions, questions
     FROM tests WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        title: row.title,
        description: row.description,
        shuffleOptions: row.shuffle_options,
        shuffleQuestions: row.shuffle_questions,
        questions: row.questions,
      }
    : null;
}

// A deleted test's mission subtask goes with it, so the mission can still be finished; a
// mission left with no subtasks at all goes too. The test's scores are kept.
export async function archiveTest(id: string, tz: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return withTransaction(async (client) => {
    const result = await client.query<{ subtask_id: string | null }>(
      "UPDATE tests SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING subtask_id",
      [id],
    );
    const archived = result.rows[0];
    if (!archived) return false;
    if (archived.subtask_id) {
      await archiveSubtask(client, archived.subtask_id, tz);
      const emptied = await client.query<{ task_id: string }>(
        `SELECT s.task_id FROM subtasks s
         WHERE s.id = $1
           AND NOT EXISTS (SELECT 1 FROM subtasks other WHERE other.task_id = s.task_id AND other.archived_at IS NULL)`,
        [archived.subtask_id],
      );
      if (emptied.rows[0]) await archiveTask(client, emptied.rows[0].task_id);
    }
    return true;
  });
}

// The browser grades (it can let you count a near miss); the server checks the shape and keeps
// it. A full run that's all correct, near misses you counted included, ticks the test's mission
// subtask: the feedback says so, and says if that finished the mission. null when not found.
export async function recordAttempt(
  id: string,
  body: unknown,
  tz: string,
): Promise<{ feedback: TaskFeedback[] } | null> {
  if (!isUuid(id)) return null;
  const test = await pool.query<{ count: number; title: string; subtask_id: string | null }>(
    `SELECT jsonb_array_length(questions) AS count, title, subtask_id
     FROM tests WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  const count = test.rows[0]?.count;
  if (count === undefined) return null;
  const { title, subtask_id: subtaskId } = test.rows[0]!;

  const responses = isObject(body) ? body.responses : undefined;
  if (!Array.isArray(responses) || responses.length !== count) {
    throw new InputError(`"responses" must hold one entry for each of the ${count} questions`);
  }
  const seen = new Set<number>();
  for (const response of responses) {
    const valid =
      isObject(response) &&
      Number.isInteger(response.question) &&
      (response.question as number) >= 0 &&
      (response.question as number) < count &&
      !seen.has(response.question as number) &&
      typeof response.correct === "boolean" &&
      (typeof response.given === "string" ||
        (Array.isArray(response.given) && response.given.every((item) => typeof item === "string"))) &&
      JSON.stringify(response.given).length <= 2000;
    if (!valid) throw new InputError("Each response needs a question number, the answer given, and whether it counted");
    seen.add(response.question as number);
  }

  const score = responses.filter((response) => (response as { correct: boolean }).correct).length;
  return withTransaction(async (client) => {
    await client.query("INSERT INTO test_attempts (test_id, score, total, responses) VALUES ($1, $2, $3, $4)", [
      id,
      score,
      count,
      JSON.stringify(responses),
    ]);
    if (score < count || !subtaskId) return { feedback: [] };
    const outcome = await completeSubtask(client, subtaskId, tz);
    if (!outcome?.ticked) return { feedback: [] };
    return { feedback: [{ kind: "changed", action: "Passed at 100% · subtask ticked", title }, ...outcome.feedback] };
  });
}
