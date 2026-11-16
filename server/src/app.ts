import path from "node:path";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { isStateKey } from "../../shared/appState.js";
import { LIMITS, type TaskFeedback } from "../../shared/model.js";
import { parsePatch, patchState, readState } from "./appState.js";
import { decodeFileName, detectImageType, loadImage, saveImage } from "./attachments.js";
import type { AppConfig } from "./config.js";
import { pool, withTransaction } from "./db.js";
import { HttpError, InputError, NotFoundError } from "./errors.js";
import { createGroup, deleteGroup, listGroups, orderNotes, setNoteGroup, updateGroup } from "./groups.js";
import { isObject, isUuid } from "./input.js";
import { createLlm, parseNoteContext, type ChatTurn } from "./llmClient.js";
import { deleteNote, listNotes, saveNote } from "./notes.js";
import {
  addPaper,
  createPaperFolder,
  deletePaper,
  deletePaperFolder,
  isPdf,
  listPapers,
  paperFileInfo,
  readPaperBytes,
  renamePaperFolder,
  updatePaper,
} from "./papers.js";
import { checkText, keepWord, suggestFor } from "./spelling.js";
import { transcribe } from "./speech.js";
import { applyActions, describeTasks, extractActions } from "./taskActions.js";
import {
  addSubtask,
  archiveSubtask,
  archiveTask,
  createTask,
  getBoard,
  parseDone,
  parseSubtaskDraft,
  parseSubtaskPatch,
  parseTaskDraft,
  parseTaskPatch,
  resolveTimeZone,
  setSubtaskDone,
  setTaskDone,
  updateSubtask,
  updateTask,
} from "./tasks.js";
import { generateTest, parseGenerateRequest } from "./testGeneration.js";
import {
  archiveTest,
  deleteTestFolder,
  getTest,
  importBatch,
  importTests,
  listTestFolders,
  listTests,
  parseImportBatch,
  recordAttempt,
  renameTestFolder,
} from "./tests.js";

const megabytes = (bytes: number) => bytes / (1024 * 1024);

// Express 4 doesn't pass a rejected promise on to the error handler by itself.
function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// What a route is about, or a 404 naming it. The modules answer null or false for "no such
// thing", an id that isn't even an id included.
function found<T>(value: T | null | undefined | false, what: string): T {
  if (value === null || value === undefined || value === false) throw new NotFoundError(what);
  return value;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

// The API has no sign-in: it trusts whoever reaches it, and that must only ever be a page of
// Argonaut itself on this PC. A browser will happily carry requests from any website to
// localhost, so two things are checked. Host: a site that points its own name at 127.0.0.1
// arrives under that name. Origin: a request made by another site's page says where it's from.
function localPagesOnly(devOrigins: string[]): RequestHandler {
  const allowed = new Set(devOrigins);
  return (req, _res, next) => {
    const host = req.headers.host ?? "";
    if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, "").toLowerCase())) {
      next(new HttpError(403, "Argonaut only answers on this PC, as localhost"));
      return;
    }
    const { origin } = req.headers;
    if (origin !== undefined && !allowed.has(origin) && !sameOrigin(origin, host)) {
      next(new HttpError(403, "That page isn't allowed to use Argonaut"));
      return;
    }
    next();
  };
}

function timeZoneOf(req: Request): Promise<string> {
  return resolveTimeZone(req.header("x-timezone"));
}

function parseHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) throw new InputError("Invalid messages payload");
  return value
    .filter(
      (turn): turn is ChatTurn =>
        isObject(turn) && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string",
    )
    .slice(-40);
}

// The part of a file a Range header asks for, as first and last byte. null when there's no
// usable range and the whole file should go; "none" when the range lies outside the file.
function requestedRange(header: string | undefined, size: number): { start: number; end: number } | "none" | null {
  // One range only; a list of ranges is answered with the whole file, which is allowed.
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    return suffix === 0 ? "none" : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (start >= size) return "none";
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return end < start ? null : { start, end };
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim().replace(/^W\//, "");
    return value === "*" || value === etag;
  });
}

// The API and, in the Docker image, the built web app on the same port. index.ts starts it
// with the settings from the environment; each test starts its own.
export function createApp(config: AppConfig): Express {
  const llm = createLlm(config.llm);
  const app = express();
  app.disable("x-powered-by");

  app.use("/api", localPagesOnly(config.devOrigins));
  // Cross-origin reads are only for the dev server; the app itself is served from this origin.
  if (config.devOrigins.length > 0) app.use("/api", cors({ origin: config.devOrigins }));
  // Not strict, so a body that is valid JSON but not an object reaches the route's own checks,
  // which explain what was expected.
  app.use(express.json({ limit: "5mb", strict: false }));

  // Task changes answer with the refreshed board, so the client never needs a second request.
  async function sendBoard(res: Response, tz: string, feedback: TaskFeedback[] | null, status = 200) {
    res.status(status).json({ board: await getBoard(pool, tz), feedback: found(feedback, "Task") });
  }

  app.get(
    "/api/health",
    route(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/state",
    route(async (_req, res) => {
      res.json(await readState());
    }),
  );

  app.patch(
    "/api/state/:key",
    route(async (req, res) => {
      const key = req.params.key ?? "";
      if (!isStateKey(key)) throw new HttpError(404, "Unknown state key");
      await patchState(key, parsePatch(key, req.body));
      res.status(204).end();
    }),
  );

  app.get(
    "/api/notes",
    route(async (_req, res) => {
      res.json(await listNotes());
    }),
  );

  // A group's notes in their new order, put into that group (see orderNotes). Registered before
  // /api/notes/:id, which would otherwise take "order" for a note id.
  app.put(
    "/api/notes/order",
    route(async (req, res) => {
      await orderNotes(req.body);
      res.status(204).end();
    }),
  );

  app.put(
    "/api/notes/:id",
    route(async (req, res) => {
      res.json({ note: await saveNote(req.params.id ?? "", req.body) });
    }),
  );

  app.delete(
    "/api/notes/:id",
    route(async (req, res) => {
      found(await deleteNote(req.params.id ?? ""), "Note");
      res.status(204).end();
    }),
  );

  app.put(
    "/api/notes/:id/group",
    route(async (req, res) => {
      found(await setNoteGroup(req.params.id ?? "", req.body), "Note");
      res.status(204).end();
    }),
  );

  // Groups of notes, with subgroups. Every change answers with the whole, updated list.
  app.get(
    "/api/groups",
    route(async (_req, res) => {
      res.json(await listGroups());
    }),
  );

  app.post(
    "/api/groups",
    route(async (req, res) => {
      const group = await createGroup(req.body);
      res.status(201).json({ group, groups: await listGroups() });
    }),
  );

  app.patch(
    "/api/groups/:id",
    route(async (req, res) => {
      found(await updateGroup(req.params.id ?? "", req.body), "Group");
      res.json(await listGroups());
    }),
  );

  app.delete(
    "/api/groups/:id",
    route(async (req, res) => {
      const { parentId } = found(await deleteGroup(req.params.id ?? ""), "Group");
      res.json({ parentId, groups: await listGroups() });
    }),
  );

  // The image bytes are the request body; its name and note travel in headers.
  app.post(
    "/api/attachments",
    express.raw({ type: () => true, limit: LIMITS.imageBytes }),
    route(async (req, res) => {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const contentType = detectImageType(data);
      if (!contentType) throw new HttpError(415, "Only PNG, JPEG, GIF and WebP images can be added");
      const noteId = req.header("x-note-id");
      const id = await saveImage(data, contentType, decodeFileName(req.header("x-file-name")), isUuid(noteId) ? noteId : null);
      res.status(201).json({ id, url: `/api/attachments/${id}` });
    }),
  );

  app.get(
    "/api/attachments/:id",
    route(async (req, res) => {
      const image = found(isUuid(req.params.id) ? await loadImage(req.params.id) : null, "Image");
      res.set({
        "Content-Type": image.contentType,
        // An id always names the same bytes, so browsers never need to ask again.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      res.send(image.data);
    }),
  );

  // Papers (PDFs) and their folders. Every change answers with the whole, updated lists.
  app.get(
    "/api/papers",
    route(async (_req, res) => {
      res.json(await listPapers());
    }),
  );

  // The PDF is the request body; its file name and folder travel in headers.
  app.post(
    "/api/papers",
    express.raw({ type: () => true, limit: LIMITS.paperBytes }),
    route(async (req, res) => {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!isPdf(data)) throw new HttpError(415, "Only PDF files can be added as papers");
      const folderId = req.header("x-folder-id");
      const fileName = decodeFileName(req.header("x-file-name")) || "paper.pdf";
      const { paper, duplicate } = await addPaper(data, fileName, isUuid(folderId) ? folderId : null);
      res.status(duplicate ? 200 : 201).json({ paper, duplicate, ...(await listPapers()) });
    }),
  );

  // The PDF itself, for the browser's viewer. The viewer asks for a large file a part at a
  // time, and asks again for one it already holds; neither needs the whole file read.
  app.get(
    "/api/papers/:id/file",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const info = found(await paperFileInfo(id), "Paper");
      const name = info.fileName || "paper.pdf";
      const etag = `"${info.sha256}"`;
      res.set({
        "Content-Type": "application/pdf",
        // Shown in the document area by the browser's own PDF viewer, under its own name.
        "Content-Disposition": `inline; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        // A paper's id always names the same bytes.
        "Cache-Control": "private, max-age=31536000, immutable",
        ETag: etag,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      });
      if (matchesEtag(req.header("if-none-match"), etag)) {
        res.status(304).end();
        return;
      }
      // A range made for an older copy of the file doesn't apply to this one.
      const ifRange = req.header("if-range");
      const range = ifRange === undefined || ifRange === etag ? requestedRange(req.header("range"), info.byteSize) : null;
      if (range === "none") {
        res.status(416).set("Content-Range", `bytes */${info.byteSize}`).end();
        return;
      }
      const length = range ? range.end - range.start + 1 : info.byteSize;
      res.set("Content-Length", String(length));
      if (range) res.status(206).set("Content-Range", `bytes ${range.start}-${range.end}/${info.byteSize}`);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(found(range ? await readPaperBytes(id, range.start, length) : await readPaperBytes(id), "Paper"));
    }),
  );

  app.patch(
    "/api/papers/:id",
    route(async (req, res) => {
      found(await updatePaper(req.params.id ?? "", req.body), "Paper");
      res.json(await listPapers());
    }),
  );

  app.delete(
    "/api/papers/:id",
    route(async (req, res) => {
      found(await deletePaper(req.params.id ?? ""), "Paper");
      res.json(await listPapers());
    }),
  );

  app.post(
    "/api/paper-folders",
    route(async (req, res) => {
      const folder = await createPaperFolder(req.body);
      res.status(201).json({ folder, ...(await listPapers()) });
    }),
  );

  app.patch(
    "/api/paper-folders/:id",
    route(async (req, res) => {
      found(await renamePaperFolder(req.params.id ?? "", req.body), "Folder");
      res.json(await listPapers());
    }),
  );

  app.delete(
    "/api/paper-folders/:id",
    route(async (req, res) => {
      found(await deletePaperFolder(req.params.id ?? ""), "Folder");
      res.json(await listPapers());
    }),
  );

  // Spell checking: the dictionaries answer from the argonaut-spell container, and the words
  // you keep are filtered out here, where they're stored.
  app.post(
    "/api/spelling/check",
    route(async (req, res) => {
      res.json(await checkText(config.spellUrl, req.body?.text, req.body?.language));
    }),
  );

  app.post(
    "/api/spelling/suggest",
    route(async (req, res) => {
      res.json({ suggestions: await suggestFor(config.spellUrl, req.body?.word, req.body?.language) });
    }),
  );

  app.post(
    "/api/spelling/keep",
    route(async (req, res) => {
      res.status(201).json({ word: await keepWord(req.body?.word, req.body?.language) });
    }),
  );

  // Speech to text for the assistant's microphone, by the argonaut-whisper container. The
  // recording is passed on in memory and dropped; neither it nor the text is stored or logged.
  app.post(
    "/api/speech/transcribe",
    express.raw({ type: () => true, limit: LIMITS.speechBytes }),
    route(async (req, res) => {
      res.json({ text: await transcribe(config.whisperUrl, req.body) });
    }),
  );

  app.get("/api/chat/status", (_req, res) => {
    res.json(llm.status());
  });

  app.post(
    "/api/chat",
    route(async (req, res) => {
      const history = parseHistory(req.body?.messages);
      const note = parseNoteContext(req.body?.note);
      const tz = await timeZoneOf(req);
      const context = describeTasks((await getBoard(pool, tz)).tasks);

      const raw = await llm.ask(history, note, context.prompt);
      const { reply, actions, unreadable } = extractActions(raw);
      const outcome =
        actions.length > 0
          ? await withTransaction((client) => applyActions(client, actions, context, tz))
          : { applied: 0, feedback: [], errors: [] };
      if (unreadable) outcome.errors.push("The assistant's task changes couldn't be read");

      res.json({
        reply: reply || "Done.",
        feedback: outcome.feedback,
        errors: outcome.errors,
        board: outcome.applied > 0 ? await getBoard(pool, tz) : null,
      });
    }),
  );

  app.get(
    "/api/tasks",
    route(async (req, res) => {
      res.json(await getBoard(pool, await timeZoneOf(req)));
    }),
  );

  app.post(
    "/api/tasks",
    route(async (req, res) => {
      const draft = parseTaskDraft(req.body);
      const tz = await timeZoneOf(req);
      await withTransaction((client) => createTask(client, draft));
      await sendBoard(res, tz, [], 201);
    }),
  );

  app.patch(
    "/api/tasks/:id",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const patch = parseTaskPatch(req.body);
      const tz = await timeZoneOf(req);
      await sendBoard(res, tz, await withTransaction((client) => updateTask(client, id, patch, tz)));
    }),
  );

  app.delete(
    "/api/tasks/:id",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const tz = await timeZoneOf(req);
      const archived = await withTransaction((client) => archiveTask(client, id));
      await sendBoard(res, tz, archived ? [] : null);
    }),
  );

  app.put(
    "/api/tasks/:id/done",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const done = parseDone(req.body);
      const tz = await timeZoneOf(req);
      await sendBoard(res, tz, await withTransaction((client) => setTaskDone(client, id, done, tz)));
    }),
  );

  app.post(
    "/api/tasks/:id/subtasks",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const draft = parseSubtaskDraft(req.body);
      const tz = await timeZoneOf(req);
      await sendBoard(res, tz, await withTransaction((client) => addSubtask(client, id, draft, tz)), 201);
    }),
  );

  app.patch(
    "/api/subtasks/:id",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const patch = parseSubtaskPatch(req.body);
      const tz = await timeZoneOf(req);
      const updated = await withTransaction((client) => updateSubtask(client, id, patch));
      await sendBoard(res, tz, updated ? [] : null);
    }),
  );

  app.delete(
    "/api/subtasks/:id",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const tz = await timeZoneOf(req);
      await sendBoard(res, tz, await withTransaction((client) => archiveSubtask(client, id, tz)));
    }),
  );

  app.put(
    "/api/subtasks/:id/done",
    route(async (req, res) => {
      const id = req.params.id ?? "";
      const done = parseDone(req.body);
      const tz = await timeZoneOf(req);
      await sendBoard(res, tz, await withTransaction((client) => setSubtaskDone(client, id, done, tz)));
    }),
  );

  app.get(
    "/api/tests",
    route(async (_req, res) => {
      res.json(await listTests());
    }),
  );

  app.post(
    "/api/tests/import",
    route(async (req, res) => {
      const { name, drafts } = parseImportBatch(req.body);
      const tz = await timeZoneOf(req);
      const batch = await withTransaction((client) => importBatch(client, drafts, name, tz));
      res.status(201).json({
        imported: drafts.length,
        questions: drafts.reduce((sum, draft) => sum + draft.questions.length, 0),
        folder: batch.folder,
        mission: batch.missionTitle,
        tests: await listTests(),
        folders: await listTestFolders(),
        board: await getBoard(pool, tz),
      });
    }),
  );

  // Folders in the sidebar's Tests section, one per import.
  app.get(
    "/api/test-folders",
    route(async (_req, res) => {
      res.json(await listTestFolders());
    }),
  );

  app.patch(
    "/api/test-folders/:id",
    route(async (req, res) => {
      found(await renameTestFolder(req.params.id ?? "", req.body), "Folder");
      res.json(await listTestFolders());
    }),
  );

  app.delete(
    "/api/test-folders/:id",
    route(async (req, res) => {
      found(await deleteTestFolder(req.params.id ?? ""), "Folder");
      res.json({ folders: await listTestFolders(), tests: await listTests() });
    }),
  );

  app.post(
    "/api/tests/generate",
    route(async (req, res) => {
      const result = await generateTest(llm, parseGenerateRequest(req.body));
      const [id] = await withTransaction((client) => importTests(client, [result.draft]));
      res.status(201).json({
        id,
        title: result.draft.title,
        questions: result.draft.questions.length,
        notesUsed: result.used,
        truncated: result.truncated,
        tests: await listTests(),
      });
    }),
  );

  app.get(
    "/api/tests/:id",
    route(async (req, res) => {
      res.json(found(await getTest(req.params.id ?? ""), "Test"));
    }),
  );

  app.delete(
    "/api/tests/:id",
    route(async (req, res) => {
      found(await archiveTest(req.params.id ?? "", await timeZoneOf(req)), "Test");
      res.json(await listTests());
    }),
  );

  // Answers with the tests, and with the task board when a pass ticked a mission subtask.
  app.post(
    "/api/tests/:id/attempts",
    route(async (req, res) => {
      const tz = await timeZoneOf(req);
      const outcome = found(await recordAttempt(req.params.id ?? "", req.body, tz), "Test");
      res.status(201).json({
        tests: await listTests(),
        update: outcome.feedback.length > 0 ? { board: await getBoard(pool, tz), feedback: outcome.feedback } : null,
      });
    }),
  );

  // Anything else under /api is a mistake in the address, and is told so in the API's own terms.
  app.use("/api", (_req, _res, next) => {
    next(new HttpError(404, "There's nothing at that address"));
  });

  if (config.publicDir) {
    const { publicDir } = config;
    app.use(express.static(publicDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  // Every way a request can fail ends here, as { error } with the right status.
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, ...error.body });
      return;
    }
    // What Express and its body parsers raise before any route runs. They say what went wrong
    // in `type` or `status`; their own messages aren't written for the person using the app.
    const raised = isObject(error) ? error : {};
    if (raised.type === "entity.too.large") {
      res.status(413).json({
        error: req.path.startsWith("/api/attachments")
          ? `Images can be at most ${megabytes(LIMITS.imageBytes)} MB`
          : req.path.startsWith("/api/papers")
            ? `A paper can be at most ${megabytes(LIMITS.paperBytes)} MB`
            : "That's too large to store",
      });
      return;
    }
    if (raised.type === "entity.parse.failed") {
      res.status(400).json({ error: "The request body isn't valid JSON" });
      return;
    }
    if (error instanceof URIError) {
      res.status(400).json({ error: "That address isn't valid" });
      return;
    }
    const status = Number(raised.status);
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: "The request couldn't be read" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
