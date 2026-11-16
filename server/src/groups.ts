import type { PoolClient } from "pg";
import { LIMITS, SECTIONS, type NoteGroup, type Section } from "../../shared/model.js";
import { pool, withTransaction } from "./db.js";
import { InputError } from "./errors.js";
import { isObject, isUuid, readLine } from "./input.js";

// Notes are organised in groups, and groups can hold subgroups. A top-level group belongs to a
// sidebar section: Notes, or Works, where each group is a book and each note a page. A note
// sits in at most one group, in the order it was put there. Deleting a group moves what it
// held up a level, so no note is ever lost with it.

const MAX_ORDERED = 2000;
const UNIQUE_VIOLATION = "23505";

function parseName(value: unknown): string {
  const name = readLine(value ?? "", "A group name", LIMITS.folderName);
  if (name === "") throw new InputError("A group needs a name");
  return name;
}

// null (or leaving it out) means the top level.
function parseGroupRef(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !isUuid(value)) throw new InputError(`"${field}" must be a group id or null`);
  return value;
}

function parseSection(value: unknown): Section | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(SECTIONS as readonly string[]).includes(value)) {
    throw new InputError('"section" must be "notes", "works" or "skills"');
  }
  return value as Section;
}

function isUniqueViolation(error: unknown): boolean {
  return isObject(error) && error.code === UNIQUE_VIOLATION;
}

async function groupExists(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM note_groups WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// A name no sibling already has: "Verbs", else "Verbs 2", "Verbs 3"… At the top level,
// siblings are the groups of the same section.
async function freeName(
  client: PoolClient,
  parentId: string | null,
  section: Section | null,
  name: string,
  self: string,
): Promise<string> {
  const taken = await client.query<{ name: string }>(
    `SELECT lower(name) AS name FROM note_groups
     WHERE parent_id IS NOT DISTINCT FROM $1
       AND ($1 IS NOT NULL OR section = $2)
       AND id <> $3`,
    [parentId, section, self],
  );
  const names = new Set(taken.rows.map((row) => row.name));
  if (!names.has(name.toLowerCase())) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

export async function listGroups(): Promise<NoteGroup[]> {
  const result = await pool.query<{ id: string; parent_id: string | null; section: Section | null; name: string }>(
    "SELECT id, parent_id, section, name FROM note_groups ORDER BY lower(name), created_at",
  );
  return result.rows.map((row) => ({ id: row.id, parentId: row.parent_id, section: row.section, name: row.name }));
}

export async function createGroup(body: unknown): Promise<NoteGroup> {
  const input = isObject(body) ? body : {};
  const name = parseName(input.name);
  const parentId = parseGroupRef(input.parentId, "parentId");
  const section = parentId ? null : (parseSection(input.section) ?? "notes");
  try {
    return await withTransaction(async (client) => {
      if (parentId && !(await groupExists(client, parentId))) {
        throw new InputError("The group to put it in no longer exists");
      }
      const result = await client.query<{ id: string }>(
        "INSERT INTO note_groups (parent_id, section, name) VALUES ($1, $2, $3) RETURNING id",
        [parentId, section, name],
      );
      return { id: result.rows[0]!.id, parentId, section, name };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new InputError(`There's already a group called “${name}” there`);
    throw error;
  }
}

// Renames a group, moves it, or both. A move gives a new parentId, or null and a section for
// the top level of Notes or Works. False when there's no such group.
export async function updateGroup(id: string, body: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const input = isObject(body) ? body : {};
  const name = input.name === undefined ? null : parseName(input.name);
  const newSection = parseSection(input.section);
  const moving = Object.hasOwn(input, "parentId") || newSection !== undefined;
  if (name === null && !moving) throw new InputError("Nothing to change");

  let current = "";
  try {
    return await withTransaction(async (client) => {
      const found = await client.query<{ name: string; parent_id: string | null; section: Section | null }>(
        "SELECT name, parent_id, section FROM note_groups WHERE id = $1 FOR UPDATE",
        [id],
      );
      const group = found.rows[0];
      if (!group) return false;
      current = group.name;

      if (!moving) {
        await client.query("UPDATE note_groups SET name = $2 WHERE id = $1", [id, name]);
        return true;
      }
      const parentId = Object.hasOwn(input, "parentId") ? parseGroupRef(input.parentId, "parentId") : group.parent_id;
      if (parentId !== null) {
        if (parentId === id) throw new InputError("A group can't go inside itself");
        if (!(await groupExists(client, parentId))) throw new InputError("The group to move it into no longer exists");
        const inside = await client.query(
          `WITH RECURSIVE below AS (
             SELECT id FROM note_groups WHERE parent_id = $1
             UNION ALL
             SELECT g.id FROM note_groups g JOIN below b ON g.parent_id = b.id
           )
           SELECT 1 FROM below WHERE id = $2`,
          [id, parentId],
        );
        if ((inside.rowCount ?? 0) > 0) throw new InputError("A group can't go inside one of its own subgroups");
      }
      const section = parentId !== null ? null : (newSection ?? group.section ?? "notes");
      await client.query(
        "UPDATE note_groups SET name = COALESCE($2, name), parent_id = $3, section = $4 WHERE id = $1",
        [id, name, parentId, section],
      );
      return true;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new InputError(`There's already a group called “${name ?? current}” there`);
    throw error;
  }
}

// Its notes and subgroups move up to its parent first, the notes after the parent's own. A
// subgroup whose name is already taken there gets a number added ("Verbs 2") rather than the
// delete failing. Deleting a top-level group sends its notes to the top level of Notes, the
// only place notes can sit outside a group. null when not found.
export async function deleteGroup(id: string): Promise<{ parentId: string | null } | null> {
  if (!isUuid(id)) return null;
  return withTransaction(async (client) => {
    const found = await client.query<{ parent_id: string | null; section: Section | null }>(
      "SELECT parent_id, section FROM note_groups WHERE id = $1 FOR UPDATE",
      [id],
    );
    const group = found.rows[0];
    if (!group) return null;

    await client.query(
      `UPDATE notes SET group_id = $2, position = moved.base + moved.place
       FROM (
         SELECT n.id,
                row_number() OVER (ORDER BY n.position NULLS LAST, n.updated_at DESC) AS place,
                COALESCE((SELECT max(o.position) FROM notes o WHERE o.group_id IS NOT DISTINCT FROM $2), 0) AS base
         FROM notes n
         WHERE n.group_id = $1
       ) AS moved
       WHERE notes.id = moved.id`,
      [id, group.parent_id],
    );
    // Until it's gone, the group still holds its name among the siblings its children join;
    // its id is a name nothing else can have.
    await client.query("UPDATE note_groups SET name = id::text WHERE id = $1", [id]);
    const childSection = group.parent_id === null ? group.section : null;
    const children = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM note_groups WHERE parent_id = $1 ORDER BY created_at",
      [id],
    );
    for (const child of children.rows) {
      const name = await freeName(client, group.parent_id, childSection, child.name, child.id);
      await client.query("UPDATE note_groups SET parent_id = $2, section = $3, name = $4 WHERE id = $1", [
        child.id,
        group.parent_id,
        childSection,
        name,
      ]);
    }
    await client.query("DELETE FROM note_groups WHERE id = $1", [id]);
    return { parentId: group.parent_id };
  });
}

// Moving a note between groups is filing, not editing, so it's stored at once and leaves the
// note's text and its edited time alone. It goes last in its new group. False when the note
// isn't in the database yet.
export async function setNoteGroup(noteId: string, body: unknown): Promise<boolean> {
  if (!isUuid(noteId)) return false;
  if (!isObject(body) || !Object.hasOwn(body, "groupId")) throw new InputError('Send "groupId": a group id, or null');
  const groupId = parseGroupRef(body.groupId, "groupId");
  if (groupId) {
    const known = await pool.query("SELECT 1 FROM note_groups WHERE id = $1", [groupId]);
    if (known.rowCount === 0) throw new InputError("That group no longer exists");
  }
  const result = await pool.query(
    `UPDATE notes SET group_id = $2,
       position = (SELECT COALESCE(max(position), 0) + 1 FROM notes WHERE group_id IS NOT DISTINCT FROM $2 AND id <> $1)
     WHERE id = $1`,
    [noteId, groupId],
  );
  return (result.rowCount ?? 0) > 0;
}

// The notes of one group (or of the top level, for null), in their new order: each is put in
// that group at its place in the list. Notes the database hasn't seen yet are skipped; they
// bring their place with their first save. Nothing else about the notes changes.
export async function orderNotes(body: unknown): Promise<void> {
  if (!isObject(body) || !Object.hasOwn(body, "groupId") || !Array.isArray(body.noteIds)) {
    throw new InputError('Send "groupId" (a group id, or null) and "noteIds" in their new order');
  }
  const groupId = parseGroupRef(body.groupId, "groupId");
  const noteIds = body.noteIds;
  if (noteIds.length > MAX_ORDERED) throw new InputError(`At most ${MAX_ORDERED} notes can be ordered at once`);
  if (!noteIds.every((id) => typeof id === "string" && isUuid(id)) || new Set(noteIds).size !== noteIds.length) {
    throw new InputError('"noteIds" must be different note ids');
  }
  await withTransaction(async (client) => {
    if (groupId && !(await groupExists(client, groupId))) throw new InputError("That group no longer exists");
    await client.query(
      `UPDATE notes SET group_id = $1, position = ordered.place
       FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, place)
       WHERE notes.id = ordered.id`,
      [groupId, noteIds],
    );
  });
}
