// Images in notes: stored once, recognised by their bytes, served as they came, and tidied
// away once no note shows them.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("images");
const { call, sql } = api;
// Imported after the app has its database, since this module reads from it.
const { sweepImages } = await import("../src/attachments.ts");

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// The server looks at the first bytes only, so a signature and any payload make a picture.
const png = (bytes = 256) => new Uint8Array(Buffer.concat([PNG_HEAD, randomBytes(bytes)]));
const jpeg = () => new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(128)]));
const svg = () => new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));

const noteId = "0b5e7a11-0000-4000-8000-00000000abcd";
const upload = (data, contentType, name = "picture.png", note = noteId) =>
  call("POST", "/api/attachments", data, {
    headers: { "Content-Type": contentType, "X-File-Name": encodeURIComponent(name), "X-Note-Id": note },
  });
const saveNote = (id, content, updatedAt = Date.now()) =>
  call("PUT", `/api/notes/${id}`, { title: "Image test", content, tags: [], createdAt: updatedAt, updatedAt });

test("images: upload, what comes back, and what's refused", async (t) => {
  const ok = (label) => t.diagnostic(label);

  const picture = png();
  let res = await upload(picture, "image/png", "prépositions.png");
  assert.equal(res.status, 201);
  assert.match(res.data.url, /^\/api\/attachments\/[0-9a-f-]{36}$/);
  const pngId = res.data.id;
  ok("a PNG uploads and gets an /api/attachments URL");

  let image = await call("GET", res.data.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.match(image.headers.get("cache-control"), /immutable/);
  assert.deepEqual(image.data, Buffer.from(picture));
  ok("it comes back byte for byte, as image/png, cacheable and unsniffable");

  res = await upload(picture, "image/png");
  assert.equal(res.data.id, pngId);
  ok("the same picture uploaded twice is stored once");

  res = await upload(jpeg(), "application/octet-stream", "photo.jpg");
  assert.equal(res.status, 201);
  image = await call("GET", res.data.url);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  ok("the type comes from the file's bytes, not what the upload claims (JPEG sent as octet-stream)");

  res = await upload(svg(), "image/png", "drawing.svg");
  assert.equal(res.status, 415);
  assert.equal(res.data.error, "Only PNG, JPEG, GIF and WebP images can be added");
  ok("an SVG claiming to be a PNG is refused");

  res = await upload(png(16 * 1024 * 1024), "image/png");
  assert.equal(res.status, 413);
  assert.equal(res.data.error, "Images can be at most 15 MB");
  ok("a 16 MB file is refused with a readable message");

  for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
    image = await call("GET", `/api/attachments/${id}`);
    assert.equal(image.status, 404, id);
    assert.equal(image.data.error, "Image not found");
  }
  ok("unknown image ids answer 404");

  res = await saveNote(noteId, `![prépositions](/api/attachments/${pngId})`);
  assert.equal(res.status, 200);
  ok("a note referring to the image saves as usual (notes stay small: only the link is stored)");
});

test("images: the ones no note shows any more are removed, carefully", async (t) => {
  const ok = (label) => t.diagnostic(label);
  const DAY = 24 * 60 * 60 * 1000;
  const age = (id, days) => sql(`UPDATE attachments SET created_at = now() - interval '${days} days' WHERE id = '${id}'`);
  const stored = async (id) => (await sql(`SELECT count(*) FROM attachments WHERE id = '${id}'`)) === "1";
  const add = async (note) => (await upload(png(), "image/png", "picture.png", note)).data.id;

  const savedNote = "0b5e7a11-0000-4000-8000-000000000001";
  const editedNote = "0b5e7a11-0000-4000-8000-000000000002";
  const staleNote = "0b5e7a11-0000-4000-8000-000000000003";
  const neverSaved = "0b5e7a11-0000-4000-8000-000000000004";

  const shown = await add(savedNote);
  await saveNote(savedNote, `Still here: ![kept](/api/attachments/${shown})`);
  const removedFromText = await add(editedNote);
  await saveNote(editedNote, "The picture was taken out of this text, and the note saved again.");
  const maybeUnsaved = await add(staleNote);
  // Last saved fifty days ago, ten days before its picture was added: the window may still
  // hold unsaved text that shows it.
  await saveNote(staleNote, "Saved before the picture was pasted.", Date.now() - 50 * DAY);
  const orphan = await add(neverSaved);
  const recent = await add(neverSaved);
  for (const id of [shown, removedFromText, maybeUnsaved, orphan]) await age(id, 40);

  assert.equal(await sweepImages(), 2);
  assert.equal(await stored(shown), true, "a picture a saved note shows stays, however old");
  assert.equal(await stored(recent), true, "a picture added lately stays, shown or not");
  assert.equal(await stored(maybeUnsaved), true, "a picture added after its note's last save stays");
  assert.equal(await stored(removedFromText), false, "a picture taken out of its note, saved since, goes");
  assert.equal(await stored(orphan), false, "an old picture whose note was never saved goes");
  ok("only old pictures that no saved note shows, and no unsaved text could, are removed");

  assert.equal(await sweepImages(), 0);
  assert.equal((await call("GET", `/api/attachments/${shown}`)).status, 200);
  ok("a second pass finds nothing more, and the kept picture still loads");
});
