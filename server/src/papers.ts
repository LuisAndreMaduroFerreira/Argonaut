import { createHash } from "node:crypto";
import { LIMITS, type Paper, type PaperFolder, type PapersState } from "../../shared/model.js";
import { pool, withTransaction } from "./db.js";
import { InputError } from "./errors.js";
import { isObject, isUuid, readLine } from "./input.js";
import { readPdfMetadata } from "./pdfMeta.js";

// Papers: PDFs kept in the database beside the notes, so a backup holds them too, shown in the
// sidebar's Papers section and read in the document area. The bytes live in their own table,
// so listing papers never reads them.

const MAX = { title: 300, authors: 1000, doi: 200 } as const;

interface PaperRow {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  doi: string;
  file_name: string;
  byte_size: number;
  pages: number | null;
  folder_id: string | null;
  created_at: Date;
}

const COLUMNS = "id, title, authors, year, doi, file_name, byte_size, pages, folder_id, created_at";

function toPaper(row: PaperRow): Paper {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    doi: row.doi,
    fileName: row.file_name,
    byteSize: row.byte_size,
    pages: row.pages,
    folderId: row.folder_id,
    addedAt: row.created_at.getTime(),
  };
}

// A PDF starts with "%PDF-", which readers accept anywhere in the first kilobyte.
export function isPdf(data: Buffer): boolean {
  return data.subarray(0, 1024).includes("%PDF-");
}

// A field of a JSON body, as one line.
function readField(value: unknown, name: string, max: number, required = false): string {
  const text = readLine(value, `"${name}"`, max);
  if (required && text === "") throw new InputError(`"${name}" can't be empty`);
  return text;
}

export async function listPapers(): Promise<PapersState> {
  const [papers, folders] = await Promise.all([
    pool.query<PaperRow>(`SELECT ${COLUMNS} FROM papers ORDER BY lower(title), created_at`),
    pool.query<PaperFolder>("SELECT id, name FROM paper_folders ORDER BY lower(name)"),
  ]);
  return { papers: papers.rows.map(toPaper), folders: folders.rows };
}

// Stores a PDF and reads its details. The same file added again is kept once: the paper
// already holding it comes back, marked as a duplicate.
export async function addPaper(
  data: Buffer,
  fileName: string,
  folderId: string | null,
): Promise<{ paper: Paper; duplicate: boolean }> {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const existing = await pool.query<PaperRow>(`SELECT ${COLUMNS} FROM papers WHERE sha256 = $1`, [sha256]);
  if (existing.rows[0]) return { paper: toPaper(existing.rows[0]), duplicate: true };

  const meta = readPdfMetadata(data, fileName);
  return withTransaction(async (client) => {
    const folder = folderId && isUuid(folderId)
      ? (await client.query<{ id: string }>("SELECT id FROM paper_folders WHERE id = $1", [folderId])).rows[0]?.id ?? null
      : null;
    const inserted = await client.query<PaperRow>(
      `INSERT INTO papers (title, authors, year, doi, file_name, byte_size, pages, sha256, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (sha256) DO NOTHING
       RETURNING ${COLUMNS}`,
      [meta.title, meta.authors, meta.year, meta.doi, fileName, data.length, meta.pages, sha256, folder],
    );
    const row = inserted.rows[0];
    if (!row) {
      // Another upload of the same file got there first.
      const winner = await client.query<PaperRow>(`SELECT ${COLUMNS} FROM papers WHERE sha256 = $1`, [sha256]);
      return { paper: toPaper(winner.rows[0]!), duplicate: true };
    }
    await client.query("INSERT INTO paper_files (paper_id, data) VALUES ($1, $2)", [row.id, data]);
    return { paper: toPaper(row), duplicate: false };
  });
}

// What's needed to answer a request for a paper's PDF without reading its bytes: the browser
// may have the file already, or want only part of it.
export async function paperFileInfo(id: string): Promise<{ fileName: string; sha256: string; byteSize: number } | null> {
  if (!isUuid(id)) return null;
  const result = await pool.query<{ file_name: string; sha256: string; byte_size: number }>(
    "SELECT file_name, sha256, byte_size FROM papers WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  return row ? { fileName: row.file_name, sha256: row.sha256, byteSize: row.byte_size } : null;
}

// The PDF's bytes: all of them, or `length` bytes from `start` (counted from 0). null if the
// paper was deleted meanwhile.
export async function readPaperBytes(id: string, start = 0, length?: number): Promise<Buffer | null> {
  const result = await pool.query<{ data: Buffer }>(
    length === undefined
      ? "SELECT data FROM paper_files WHERE paper_id = $1"
      : "SELECT substring(data FROM $2::int + 1 FOR $3::int) AS data FROM paper_files WHERE paper_id = $1",
    length === undefined ? [id] : [id, start, length],
  );
  return result.rows[0]?.data ?? null;
}

// Edits the details shown for a paper, or files it in a folder (null for none). Only the fields
// sent change.
export async function updatePaper(id: string, body: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  if (!isObject(body)) throw new InputError("Expected the details to change");
  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (body.title !== undefined) set("title", readField(body.title, "title", MAX.title, true));
  if (body.authors !== undefined) set("authors", readField(body.authors, "authors", MAX.authors));
  if (body.doi !== undefined) {
    set("doi", readField(body.doi, "doi", MAX.doi).replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, ""));
  }
  if (body.year !== undefined) {
    const year = body.year;
    if (year !== null && !(typeof year === "number" && Number.isInteger(year) && year >= 1000 && year <= 2200)) {
      throw new InputError('"year" must be a year such as 2017, or null');
    }
    set("year", year);
  }
  if (body.folderId !== undefined) {
    const folderId = body.folderId;
    if (folderId !== null && !(typeof folderId === "string" && isUuid(folderId))) {
      throw new InputError('"folderId" must be a folder id, or null');
    }
    if (folderId !== null) {
      const found = await pool.query("SELECT 1 FROM paper_folders WHERE id = $1", [folderId]);
      if (found.rowCount === 0) throw new InputError("That folder no longer exists");
    }
    set("folder_id", folderId);
  }
  if (sets.length === 0) throw new InputError("Nothing to change");
  const result = await pool.query(`UPDATE papers SET ${sets.join(", ")} WHERE id = $1`, values);
  return (result.rowCount ?? 0) > 0;
}

// Deleting a paper deletes its PDF too; there's no other copy.
export async function deletePaper(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await pool.query("DELETE FROM papers WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

async function checkFolderName(body: unknown, except: string | null): Promise<string> {
  const name = readField(isObject(body) ? body.name : undefined, "name", LIMITS.folderName, true);
  const clash = await pool.query("SELECT 1 FROM paper_folders WHERE lower(name) = lower($1) AND id IS DISTINCT FROM $2", [
    name,
    except,
  ]);
  if ((clash.rowCount ?? 0) > 0) throw new InputError(`There's already a folder called “${name}”`);
  return name;
}

export async function createPaperFolder(body: unknown): Promise<PaperFolder> {
  const name = await checkFolderName(body, null);
  const result = await pool.query<PaperFolder>("INSERT INTO paper_folders (name) VALUES ($1) RETURNING id, name", [name]);
  return result.rows[0]!;
}

export async function renamePaperFolder(id: string, body: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const name = await checkFolderName(body, id);
  const result = await pool.query("UPDATE paper_folders SET name = $2 WHERE id = $1", [id, name]);
  return (result.rowCount ?? 0) > 0;
}

// The folder goes; its papers stay, in no folder.
export async function deletePaperFolder(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await pool.query("DELETE FROM paper_folders WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
