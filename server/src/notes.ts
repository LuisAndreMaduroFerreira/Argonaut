import type { Note } from "../../shared/model.js";
import { pool } from "./db.js";
import { HttpError, InputError } from "./errors.js";
import { isObject, isUuid } from "./input.js";
import { isNoteLanguage } from "./spelling.js";

interface NoteRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  language: string;
  group_id: string | null;
  position: number | null;
  created_at: string;
  updated_at: string;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    language: row.language,
    groupId: row.group_id,
    position: row.position,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function listNotes(): Promise<Note[]> {
  const result = await pool.query<NoteRow>("SELECT * FROM notes ORDER BY updated_at DESC");
  return result.rows.map(toNote);
}

// A time as the browser's clock gives it: whole milliseconds.
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const optional = (value: unknown, valid: (value: unknown) => boolean) => value === undefined || valid(value);
const isGroupRef = (value: unknown) => value === null || isUuid(value);
const isPosition = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));

// Stores a note as the window has it. A window that doesn't send groupId or position (one
// opened before they existed) leaves them alone, and a new note without a position goes last
// in its group. A group deleted meanwhile leaves the note in no group rather than failing.
//
// `baseUpdatedAt` is the edit time of the stored copy this window started from. If the stored
// copy has since changed (another window saved it), nothing is written and the answer is a 409
// carrying that copy, so the two can be reconciled instead of the last save silently winning.
// A window that doesn't send it isn't checked.
export async function saveNote(id: string, body: unknown): Promise<Note> {
  const input = isObject(body) ? body : {};
  const { title, content, tags, language, groupId, position, createdAt, updatedAt, baseUpdatedAt } = input;
  if (
    !isUuid(id) ||
    typeof title !== "string" ||
    typeof content !== "string" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    !optional(language, isNoteLanguage) ||
    !optional(groupId, isGroupRef) ||
    !optional(position, isPosition) ||
    !optional(createdAt, isTimestamp) ||
    !optional(updatedAt, isTimestamp) ||
    !optional(baseUpdatedAt, (value) => value === null || isTimestamp(value))
  ) {
    throw new InputError("Invalid note payload");
  }

  const saved = await pool.query<NoteRow>(
    `WITH target AS (SELECT (SELECT id FROM note_groups WHERE id = $8) AS group_id)
     INSERT INTO notes (id, title, content, tags, language, created_at, updated_at, group_id, position)
     SELECT $1, $2, $3, $4, $5, $6, $7, target.group_id,
            COALESCE($10, (SELECT COALESCE(max(n.position), 0) + 1 FROM notes n
                           WHERE n.group_id IS NOT DISTINCT FROM target.group_id))
     FROM target
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       tags = EXCLUDED.tags,
       language = EXCLUDED.language,
       updated_at = EXCLUDED.updated_at,
       group_id = CASE WHEN $9 THEN EXCLUDED.group_id ELSE notes.group_id END,
       position = CASE WHEN $11 THEN EXCLUDED.position ELSE notes.position END
     -- Unchanged since this window read it, or this very save arriving a second time.
     WHERE $12::bigint IS NULL OR notes.updated_at = $12 OR notes.updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      id,
      title,
      content,
      tags,
      language ?? "",
      createdAt ?? Date.now(),
      updatedAt ?? Date.now(),
      groupId ?? null,
      groupId !== undefined,
      position ?? null,
      position !== undefined,
      baseUpdatedAt ?? null,
    ],
  );
  if (saved.rows[0]) return toNote(saved.rows[0]);

  const current = await pool.query<NoteRow>("SELECT * FROM notes WHERE id = $1", [id]);
  throw new HttpError(409, "This note was changed in another window after it was opened here", {
    // null in the unlikely case that it was deleted between the two statements.
    note: current.rows[0] ? toNote(current.rows[0]) : null,
  });
}

export async function deleteNote(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await pool.query("DELETE FROM notes WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
