import { createHash } from "node:crypto";
import { pool } from "./db.js";

export interface StoredImage {
  contentType: string;
  data: Buffer;
}

// Raster formats only, recognised by their first bytes rather than by what the upload
// claims to be. SVG is left out: it can carry scripts and is served from the app's origin.
const SIGNATURES: { type: string; matches: (data: Buffer) => boolean }[] = [
  {
    type: "image/png",
    matches: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { type: "image/jpeg", matches: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { type: "image/gif", matches: (data) => /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1")) },
  {
    type: "image/webp",
    matches: (data) =>
      data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

export function detectImageType(data: Buffer): string | null {
  return SIGNATURES.find((signature) => signature.matches(data))?.type ?? null;
}

export function decodeFileName(header: string | undefined): string {
  if (!header) return "";
  try {
    return decodeURIComponent(header).slice(0, 200);
  } catch {
    return "";
  }
}

// The same picture added twice is stored once; both notes point at the one copy.
export async function saveImage(
  data: Buffer,
  contentType: string,
  fileName: string,
  noteId: string | null,
): Promise<string> {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO attachments (note_id, file_name, content_type, byte_size, sha256, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sha256) DO NOTHING
     RETURNING id`,
    [noteId, fileName, contentType, data.length, sha256, data],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;

  const existing = await pool.query<{ id: string }>("SELECT id FROM attachments WHERE sha256 = $1", [sha256]);
  return existing.rows[0]!.id;
}

// Removes pictures no note shows any more, and answers with how many went. A picture is stored
// the moment it's pasted, before its note is saved, so these are kept regardless:
// - pictures added in the last `graceDays`, wherever they are;
// - pictures whose note hasn't been saved since they were added: the unsaved text in the
//   window may still show them.
export async function sweepImages(graceDays = 30): Promise<number> {
  const result = await pool.query(
    `DELETE FROM attachments a
     WHERE a.created_at < now() - make_interval(days => $1)
       AND NOT EXISTS (SELECT 1 FROM notes n WHERE position(a.id::text IN n.content) > 0)
       AND NOT EXISTS (
         SELECT 1 FROM notes n
         WHERE n.id = a.note_id AND n.updated_at <= extract(epoch FROM a.created_at) * 1000
       )`,
    [graceDays],
  );
  return result.rowCount ?? 0;
}

export async function loadImage(id: string): Promise<StoredImage | null> {
  const result = await pool.query<{ content_type: string; data: Buffer }>(
    "SELECT content_type, data FROM attachments WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  return row ? { contentType: row.content_type, data: row.data } : null;
}
