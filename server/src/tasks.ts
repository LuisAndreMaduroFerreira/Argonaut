import type { PoolClient } from "pg";
import {
  CADENCES,
  LIMITS,
  type Cadence,
  type Task,
  type TaskBoard,
  type TaskDraft,
  type TaskFeedback,
  type TaskPatch,
  type TextFields,
} from "../../shared/model.js";
import { pool } from "./db.js";
import { InputError } from "./errors.js";
import { asObject, isUuid, readLine } from "./input.js";

type Db = PoolClient | typeof pool;

export type SubtaskPatch = Omit<TaskPatch, "cadence" | "repeats">;

export function isCadence(value: unknown): value is Cadence {
  return (CADENCES as readonly unknown[]).includes(value);
}

const knownZones = new Map<string, boolean>();

// Periods roll over at the user's local midnight, so the browser sends its IANA zone.
// Validated against Postgres itself, since that is where the zone gets used.
export async function resolveTimeZone(header: string | undefined): Promise<string> {
  if (!header || !/^[A-Za-z0-9_+-/]{1,64}$/.test(header)) return "UTC";
  let known = knownZones.get(header);
  if (known === undefined) {
    const result = await pool.query("SELECT 1 FROM pg_timezone_names WHERE name = $1", [header]);
    known = (result.rowCount ?? 0) > 0;
    if (knownZones.size > 100) knownZones.clear();
    knownZones.set(header, known);
  }
  return known ? header : "UTC";
}

// Titles and subtext are single lines: they are shown on cards and listed in the assistant's prompt.
function readTitle(value: unknown): string {
  const title = readLine(value, "Title", LIMITS.taskTitle);
  if (title.length === 0) throw new InputError("A title is required");
  return title;
}

function readSubtext(value: unknown): string {
  return value === null ? "" : readLine(value, "Subtext", LIMITS.taskSubtext);
}

function readCadence(value: unknown): Cadence {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : value;
  if (!isCadence(upper)) throw new InputError("Cadence must be daily, weekly, monthly or yearly");
  return upper;
}

function readRepeats(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InputError("repeats must be true (repeating) or false (one-time)");
  return value;
}

function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value);
}

export function parseSubtaskDraft(body: unknown): TextFields {
  const input = asObject(body);
  return { title: readTitle(input.title), subtext: optional(input.subtext, readSubtext) ?? "" };
}

export function parseTaskDraft(body: unknown): TaskDraft {
  const input = asObject(body);
  const subtasks = input.subtasks ?? [];
  if (!Array.isArray(subtasks) || subtasks.length > LIMITS.subtasks) {
    throw new InputError(`Subtasks must be a list of at most ${LIMITS.subtasks}`);
  }
  return {
    title: readTitle(input.title),
    subtext: optional(input.subtext, readSubtext) ?? "",
    cadence: readCadence(input.cadence),
    repeats: optional(input.repeats, readRepeats) ?? true,
    subtasks: subtasks.map(parseSubtaskDraft),
  };
}

export function parseSubtaskPatch(body: unknown): SubtaskPatch {
  const input = asObject(body);
  const patch = { title: optional(input.title, readTitle), subtext: optional(input.subtext, readSubtext) };
  if (patch.title === undefined && patch.subtext === undefined) throw new InputError("Nothing to change");
  return patch;
}

export function parseTaskPatch(body: unknown): TaskPatch {
  const input = asObject(body);
  const patch = {
    title: optional(input.title, readTitle),
    subtext: optional(input.subtext, readSubtext),
    cadence: optional(input.cadence, readCadence),
    repeats: optional(input.repeats, readRepeats),
  };
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new InputError("Nothing to change");
  }
  return patch;
}

export function parseDone(body: unknown): boolean {
  const { done } = asObject(body);
  if (typeof done !== "boolean") throw new InputError("done must be true or false");
  return done;
}

function streakFor(indexes: number[], current: number): number {
  const done = new Set(indexes);
  // An unfinished current period doesn't break the streak until it ends.
  let cursor = done.has(current) ? current : current - 1;
  let streak = 0;
  while (done.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

interface TaskRow {
  id: string;
  title: string;
  subtext: string;
  cadence: Cadence;
  repeats: boolean;
  period_index: number;
  completion_indexes: number[];
  ever_done: boolean;
  subtasks: { id: string; title: string; subtext: string; done_now: boolean; done_ever: boolean }[];
}

async function listTasks(db: Db, tz: string): Promise<Task[]> {
  const result = await db.query<TaskRow>(
    `SELECT t.id, t.title, t.subtext, t.cadence, t.repeats, p.period_index,
            COALESCE((
              SELECT array_agg(c.period_index)
              FROM task_completions c
              WHERE c.task_id = t.id AND c.cadence = t.cadence
            ), '{}') AS completion_indexes,
            EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id = t.id) AS ever_done,
            COALESCE((
              SELECT json_agg(
                       json_build_object(
                         'id', s.id,
                         'title', s.title,
                         'subtext', s.subtext,
                         'done_now', EXISTS (
                           SELECT 1 FROM subtask_completions sc
                           WHERE sc.subtask_id = s.id
                             AND sc.cadence = t.cadence
                             AND sc.period_index = p.period_index
                         ),
                         'done_ever', EXISTS (
                           SELECT 1 FROM subtask_completions sc WHERE sc.subtask_id = s.id
                         )
                       )
                       ORDER BY s.created_at, s.id
                     )
              FROM subtasks s
              WHERE s.task_id = t.id AND s.archived_at IS NULL
            ), '[]') AS subtasks
     FROM tasks t
     CROSS JOIN LATERAL task_period(t.cadence, $1) p
     WHERE t.archived_at IS NULL
     ORDER BY t.cadence, t.created_at, t.id`,
    [tz],
  );
  return result.rows.flatMap((row) => {
    const doneNow = row.completion_indexes.includes(row.period_index);
    // A one-time task finished in an earlier period has served its purpose.
    if (!row.repeats && row.ever_done && !doneNow) return [];
    return [
      {
        id: row.id,
        title: row.title,
        subtext: row.subtext,
        cadence: row.cadence,
        repeats: row.repeats,
        done: row.repeats ? doneNow : row.ever_done,
        streak: row.repeats ? streakFor(row.completion_indexes, row.period_index) : 0,
        subtasks: row.subtasks.map((subtask) => ({
          id: subtask.id,
          title: subtask.title,
          subtext: subtask.subtext,
          done: row.repeats ? subtask.done_now : subtask.done_ever,
        })),
      },
    ];
  });
}

export async function getBoard(db: Db, tz: string): Promise<TaskBoard> {
  const tasks = await listTasks(db, tz);
  const periods = await db.query<{ cadence: Cadence; period_key: string; period_end: Date }>(
    `SELECT c.cadence, p.period_key, p.period_end
     FROM unnest(enum_range(NULL::task_cadence)) AS c (cadence)
     CROSS JOIN LATERAL task_period(c.cadence, $1) p`,
    [tz],
  );
  return {
    periods: Object.fromEntries(
      periods.rows.map((row) => [row.cadence, { key: row.period_key, endsAt: row.period_end.toISOString() }]),
    ) as TaskBoard["periods"],
    tasks,
  };
}

interface TaskState {
  id: string;
  title: string;
  cadence: Cadence;
  repeats: boolean;
  period_index: number;
}

// Locks the task row, so two windows toggling its subtasks at once can't leave it half-synced.
async function findTask(client: PoolClient, id: string, tz: string): Promise<TaskState | null> {
  if (!isUuid(id)) return null;
  const result = await client.query<TaskState>(
    `SELECT t.id, t.title, t.cadence, t.repeats, p.period_index
     FROM tasks t
     CROSS JOIN LATERAL task_period(t.cadence, $2) p
     WHERE t.id = $1 AND t.archived_at IS NULL
     FOR UPDATE OF t`,
    [id, tz],
  );
  return result.rows[0] ?? null;
}

async function findSubtask(
  client: PoolClient,
  id: string,
  tz: string,
): Promise<{ subtaskId: string; subtaskTitle: string; task: TaskState } | null> {
  if (!isUuid(id)) return null;
  const result = await client.query<TaskState & { subtask_title: string }>(
    `SELECT t.id, t.title, t.cadence, t.repeats, p.period_index, s.title AS subtask_title
     FROM subtasks s
     JOIN tasks t ON t.id = s.task_id
     CROSS JOIN LATERAL task_period(t.cadence, $2) p
     WHERE s.id = $1 AND s.archived_at IS NULL AND t.archived_at IS NULL
     FOR UPDATE OF t`,
    [id, tz],
  );
  const row = result.rows[0];
  if (!row) return null;
  const { subtask_title, ...task } = row;
  return { subtaskId: id, subtaskTitle: subtask_title, task };
}

async function completedFeedback(client: PoolClient, task: TaskState, tz: string): Promise<TaskFeedback> {
  const sameCadence = (await listTasks(client, tz)).filter((candidate) => candidate.cadence === task.cadence);
  return {
    kind: "completed",
    title: task.title,
    cadence: task.cadence,
    done: sameCadence.filter((candidate) => candidate.done).length,
    total: sameCadence.length,
    streak: sameCadence.find((candidate) => candidate.id === task.id)?.streak ?? 1,
  };
}

// Marks that count as "done": this period's for a repeating task, any period's for a one-time one.
const MARK_COUNTS = `($4 OR (cadence = $2 AND period_index = $3))`;

// A task with subtasks is done exactly when all of them are.
async function syncTaskDone(client: PoolClient, task: TaskState, tz: string): Promise<TaskFeedback[]> {
  const anyPeriod = !task.repeats;
  const state = await client.query<{ total: number; done: number; task_done: boolean }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM subtask_completions
                WHERE subtask_id = s.id AND ${MARK_COUNTS}
              )
            )::int AS done,
            EXISTS (
              SELECT 1 FROM task_completions
              WHERE task_id = $1 AND ${MARK_COUNTS}
            ) AS task_done
     FROM subtasks s
     WHERE s.task_id = $1 AND s.archived_at IS NULL`,
    [task.id, task.cadence, task.period_index, anyPeriod],
  );
  const { total, done, task_done } = state.rows[0]!;
  if (total === 0) return [];

  if (done === total && !task_done) {
    await client.query(
      "INSERT INTO task_completions (task_id, cadence, period_index) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [task.id, task.cadence, task.period_index],
    );
    return [await completedFeedback(client, task, tz)];
  }
  if (done < total && task_done) {
    await client.query(`DELETE FROM task_completions WHERE task_id = $1 AND ${MARK_COUNTS}`, [
      task.id,
      task.cadence,
      task.period_index,
      anyPeriod,
    ]);
  }
  return [];
}

export async function createTask(client: PoolClient, draft: TaskDraft): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    "INSERT INTO tasks (title, subtext, cadence, repeats) VALUES ($1, $2, $3, $4) RETURNING id",
    [draft.title, draft.subtext, draft.cadence, draft.repeats],
  );
  const id = inserted.rows[0]!.id;
  for (const subtask of draft.subtasks) {
    await client.query("INSERT INTO subtasks (task_id, title, subtext) VALUES ($1, $2, $3)", [
      id,
      subtask.title,
      subtask.subtext,
    ]);
  }
  return id;
}

export async function updateTask(
  client: PoolClient,
  id: string,
  patch: TaskPatch,
  tz: string,
): Promise<TaskFeedback[] | null> {
  if (!isUuid(id)) return null;
  const result = await client.query(
    `UPDATE tasks
     SET title = COALESCE($2, title),
         subtext = COALESCE($3, subtext),
         cadence = COALESCE($4::task_cadence, cadence),
         repeats = COALESCE($5, repeats)
     WHERE id = $1 AND archived_at IS NULL`,
    [id, patch.title ?? null, patch.subtext ?? null, patch.cadence ?? null, patch.repeats ?? null],
  );
  if ((result.rowCount ?? 0) === 0) return null;
  // Which marks count depends on the cadence and on whether the task repeats, so changing
  // either can change whether it counts as done.
  const changedRule = patch.cadence !== undefined || patch.repeats !== undefined;
  const task = changedRule ? await findTask(client, id, tz) : null;
  return task ? syncTaskDone(client, task, tz) : [];
}

// Archived rather than deleted, so streak history survives.
export async function archiveTask(client: PoolClient, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await client.query(
    "UPDATE tasks SET archived_at = now() WHERE id = $1 AND archived_at IS NULL",
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addSubtask(
  client: PoolClient,
  taskId: string,
  draft: TextFields,
  tz: string,
): Promise<TaskFeedback[] | null> {
  const task = await findTask(client, taskId, tz);
  if (!task) return null;
  const count = await client.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM subtasks WHERE task_id = $1 AND archived_at IS NULL",
    [task.id],
  );
  if (count.rows[0]!.total >= LIMITS.subtasks) {
    throw new InputError(`A task can have at most ${LIMITS.subtasks} subtasks`);
  }
  await client.query("INSERT INTO subtasks (task_id, title, subtext) VALUES ($1, $2, $3)", [
    task.id,
    draft.title,
    draft.subtext,
  ]);
  return syncTaskDone(client, task, tz);
}

export async function updateSubtask(client: PoolClient, id: string, patch: SubtaskPatch): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await client.query(
    `UPDATE subtasks s
     SET title = COALESCE($2, s.title),
         subtext = COALESCE($3, s.subtext)
     FROM tasks t
     WHERE s.id = $1 AND t.id = s.task_id AND s.archived_at IS NULL AND t.archived_at IS NULL`,
    [id, patch.title ?? null, patch.subtext ?? null],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function archiveSubtask(client: PoolClient, id: string, tz: string): Promise<TaskFeedback[] | null> {
  const found = await findSubtask(client, id, tz);
  if (!found) return null;
  await client.query("UPDATE subtasks SET archived_at = now() WHERE id = $1", [found.subtaskId]);
  return syncTaskDone(client, found.task, tz);
}

// Marking a task with subtasks done ticks all of them; reopening it clears them — for this
// period if it repeats, or entirely if it's a one-time task.
export async function setTaskDone(
  client: PoolClient,
  id: string,
  done: boolean,
  tz: string,
): Promise<TaskFeedback[] | null> {
  const task = await findTask(client, id, tz);
  if (!task) return null;
  const period = [task.id, task.cadence, task.period_index];

  if (!done) {
    const marks = [...period, !task.repeats];
    await client.query(
      `DELETE FROM subtask_completions sc
       USING subtasks s
       WHERE sc.subtask_id = s.id AND s.task_id = $1
         AND ($4 OR (sc.cadence = $2 AND sc.period_index = $3))`,
      marks,
    );
    await client.query(`DELETE FROM task_completions WHERE task_id = $1 AND ${MARK_COUNTS}`, marks);
    return [];
  }

  await client.query(
    `INSERT INTO subtask_completions (subtask_id, cadence, period_index)
     SELECT s.id, $2::task_cadence, $3::int
     FROM subtasks s
     WHERE s.task_id = $1 AND s.archived_at IS NULL
     ON CONFLICT DO NOTHING`,
    period,
  );
  const inserted = await client.query(
    "INSERT INTO task_completions (task_id, cadence, period_index) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    period,
  );
  return (inserted.rowCount ?? 0) > 0 ? [await completedFeedback(client, task, tz)] : [];
}

// Ticks a subtask unless it already counts as done; `ticked` says whether this call did it.
// null when the subtask, or its task, is gone.
export async function completeSubtask(
  client: PoolClient,
  id: string,
  tz: string,
): Promise<{ ticked: boolean; feedback: TaskFeedback[] } | null> {
  const found = await findSubtask(client, id, tz);
  if (!found) return null;
  const { task } = found;
  const inserted = await client.query(
    `INSERT INTO subtask_completions (subtask_id, cadence, period_index)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM subtask_completions WHERE subtask_id = $1 AND ${MARK_COUNTS})`,
    [found.subtaskId, task.cadence, task.period_index, !task.repeats],
  );
  if ((inserted.rowCount ?? 0) === 0) return { ticked: false, feedback: [] };
  return { ticked: true, feedback: await syncTaskDone(client, task, tz) };
}

export async function setSubtaskDone(
  client: PoolClient,
  id: string,
  done: boolean,
  tz: string,
): Promise<TaskFeedback[] | null> {
  const found = await findSubtask(client, id, tz);
  if (!found) return null;
  const { task } = found;

  if (done) {
    await client.query(
      `INSERT INTO subtask_completions (subtask_id, cadence, period_index)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [found.subtaskId, task.cadence, task.period_index],
    );
  } else {
    await client.query(`DELETE FROM subtask_completions WHERE subtask_id = $1 AND ${MARK_COUNTS}`, [
      found.subtaskId,
      task.cadence,
      task.period_index,
      !task.repeats,
    ]);
  }
  return syncTaskDone(client, task, tz);
}
