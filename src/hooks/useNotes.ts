import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note, SaveState } from "../types";
import { ApiError, ApiUnreachableError, errorMessage } from "../lib/api";
import { deleteNoteRemote, fetchNotes, saveNote } from "../lib/notesApi";
import { orderNotesRemote } from "../lib/groupsApi";
import { inOrder } from "../lib/groups";
import { readStorage, writeStorage } from "../lib/storage";

const STORAGE_KEY = "knowledge-vault.notes";

interface NotesCache {
  notes: Note[];
  // updatedAt of the copy last known to be in the database, per note id.
  saved: Record<string, number>;
}

// The offline copy is written this long after typing pauses, rather than on every keystroke.
const CACHE_DELAY_MS = 400;

// A save turned down because another window saved the note after this one opened it.
export interface SaveConflict {
  noteId: string;
  // The copy in the database now; null if it was deleted meanwhile.
  theirs: Note | null;
}

export type ConflictChoice = "mine" | "theirs" | "both";

// The latest save that didn't reach the database, for the pop-up that reports it.
export interface SaveFailure {
  // Different for every failed save, so each one brings the pop-up up again.
  id: number;
  noteId: string;
  // Nothing answered (Argonaut's services, Docker or WSL are down), rather than a refusal.
  unreachable: boolean;
  message: string;
  // Failed saves of this note in a row.
  attempt: number;
}

function welcomeNote(): Note {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "Welcome",
    content:
      "# Welcome to Argonaut\n\n" +
      "- Write notes in **Markdown**\n" +
      "- Link ideas with `[[wikilinks]]`\n" +
      "- Press the speaker button to hear a note read aloud\n" +
      "- Press Ctrl+S (Cmd+S) to save a note to the database\n",
    tags: ["getting-started"],
    language: "",
    groupId: null,
    position: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Copies cached before groups and ordering existed have neither.
function withGroup(notes: Note[]): Note[] {
  return notes.map((note) =>
    note.groupId === undefined || note.position === undefined
      ? { ...note, groupId: note.groupId ?? null, position: note.position ?? null }
      : note,
  );
}

// The place after the last note already in a group.
function nextPosition(notes: Note[], groupId: string | null): number {
  return notes.reduce((last, note) => (note.groupId === groupId ? Math.max(last, note.position ?? 0) : last), 0) + 1;
}

function readCache(): NotesCache {
  const raw = readStorage(STORAGE_KEY);
  if (!raw) return { notes: [], saved: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    // Earlier versions cached a bare array with no sync information.
    if (Array.isArray(parsed)) return { notes: withGroup(parsed as Note[]), saved: {} };
    const cache = parsed as Partial<NotesCache>;
    return Array.isArray(cache.notes)
      ? { notes: withGroup(cache.notes), saved: cache.saved ?? {} }
      : { notes: [], saved: {} };
  } catch {
    return { notes: [], saved: {} };
  }
}

// The cache can hold work the server has never seen, so the server list must not simply
// replace it: unsaved new notes stay, and local edits newer than the stored copy win.
function mergeWithServer(cache: NotesCache, remote: Note[]): NotesCache {
  const localById = new Map(cache.notes.map((note) => [note.id, note]));
  const remoteIds = new Set(remote.map((note) => note.id));

  // A note that was saved before but is gone now was deleted from another window.
  const unsaved = cache.notes.filter((note) => !remoteIds.has(note.id) && cache.saved[note.id] === undefined);

  const saved: Record<string, number> = {};
  const synced = remote.map((server) => {
    saved[server.id] = server.updatedAt;
    const local = localById.get(server.id);
    // Unsaved edits win, but where a note is filed is stored the moment it changes, so the
    // database has the latest word on that.
    return local && local.updatedAt > server.updatedAt
      ? { ...local, groupId: server.groupId, position: server.position }
      : server;
  });

  return { notes: [...unsaved, ...synced], saved };
}

export function useNotes() {
  const [initial] = useState(readCache);
  const [notes, setNotes] = useState<Note[]>(initial.notes);
  const [saved, setSaved] = useState<Record<string, number>>(initial.saved);
  const [loaded, setLoaded] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  // Every note whose last save failed, not just the latest one.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  // The offline copy is the only copy of unsaved edits, so a failure to write it is reported.
  const [offlineCopyFailed, setOfflineCopyFailed] = useState(false);
  const failures = useRef(0);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Every save that fails is reported, so trying again while the services are down says so again.
  const reportSaveFailure = useCallback((noteId: string, cause: unknown) => {
    failures.current += 1;
    const id = failures.current;
    setSaveFailure((previous) => ({
      id,
      noteId,
      unreachable: cause instanceof ApiUnreachableError,
      message: errorMessage(cause, "The note couldn't be saved"),
      attempt: previous?.noteId === noteId ? previous.attempt + 1 : 1,
    }));
  }, []);

  // Only the report it was shown for, so a report closing late can't take a newer one with it.
  const dismissSaveFailure = useCallback((id: number) => {
    setSaveFailure((current) => (current?.id === id ? null : current));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchNotes()
      .then((remote) => {
        if (cancelled) return;
        // Merge against the latest state so edits typed while loading survive.
        const merged = mergeWithServer({ notes: notesRef.current, saved: savedRef.current }, remote);
        setNotes(merged.notes.length > 0 ? merged.notes : [welcomeNote()]);
        setSaved(merged.saved);
      })
      .catch(() => {
        // Offline: keep working from the cache.
        if (!cancelled) setNotes((current) => (current.length > 0 ? current : [welcomeNote()]));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Written once typing pauses, and straight away when the window is hidden or closed.
  useEffect(() => {
    const write = () => setOfflineCopyFailed(!writeStorage(STORAGE_KEY, JSON.stringify({ notes, saved })));
    const timer = window.setTimeout(write, CACHE_DELAY_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") write();
    };
    window.addEventListener("pagehide", write);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", write);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [notes, saved]);

  const recentNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [notes],
  );

  const createNote = useCallback(
    (title = "Untitled", options: { save?: boolean; groupId?: string | null } = {}): string => {
      const now = Date.now();
      const groupId = options.groupId ?? null;
      const note: Note = {
        id: crypto.randomUUID(),
        title,
        content: "",
        tags: [],
        language: "",
        groupId,
        // New notes go last in their group, so a work's new page follows its last one.
        position: nextPosition(notesRef.current, groupId),
        createdAt: now,
        updatedAt: now,
      };
      setNotes((prev) => [note, ...prev]);
      // A note made from a link is stored straight away, so the link never points at nothing.
      if (options.save) {
        saveNote(note, null)
          .then(() => setSaved((prev) => ({ ...prev, [note.id]: note.updatedAt })))
          // Still in the list and the offline copy; Ctrl+S saves it later.
          .catch((cause: unknown) => reportSaveFailure(note.id, cause));
      }
      return note.id;
    },
    [reportSaveFailure],
  );

  // Files notes in a group in the order given: each goes into the group at its place in the
  // list. Filing is stored at once and doesn't count as an edit, so a saved note stays saved;
  // a note the database hasn't seen yet brings its place with its first save.
  const placeNotes = useCallback(async (groupId: string | null, ids: string[]): Promise<void> => {
    const place = new Map(ids.map((id, index) => [id, index + 1]));
    const before = notesRef.current;
    setNotes((prev) =>
      prev.map((note) => (place.has(note.id) ? { ...note, groupId, position: place.get(note.id)! } : note)),
    );
    try {
      await orderNotesRemote(groupId, ids);
    } catch (error) {
      const previous = new Map(before.map((note) => [note.id, note]));
      setNotes((prev) =>
        prev.map((note) => {
          const old = previous.get(note.id);
          return place.has(note.id) && old ? { ...note, groupId: old.groupId, position: old.position } : note;
        }),
      );
      throw error;
    }
  }, []);

  // Into a group (or the top level, for null), at `index` among its notes, or last.
  const moveNote = useCallback(
    (id: string, groupId: string | null, index?: number): Promise<void> => {
      const others = inOrder(notesRef.current.filter((note) => note.groupId === groupId && note.id !== id));
      const ids = others.map((note) => note.id);
      ids.splice(index ?? ids.length, 0, id);
      return placeNotes(groupId, ids);
    },
    [placeNotes],
  );

  // After a group is deleted, the database has already moved its notes to `to`, after the
  // ones there; this does the same here, including notes that were never saved.
  const reassignGroup = useCallback((from: string, to: string | null) => {
    setNotes((prev) => {
      const base = nextPosition(prev, to) - 1;
      const moved = new Map(inOrder(prev.filter((note) => note.groupId === from)).map((note, index) => [note.id, index]));
      return prev.map((note) =>
        moved.has(note.id) ? { ...note, groupId: to, position: base + moved.get(note.id)! + 1 } : note,
      );
    });
  }, []);

  const updateNote = useCallback(
    (id: string, patch: Partial<Pick<Note, "title" | "content" | "tags" | "language">>) => {
      setNotes((prev) =>
        prev.map((note) => (note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note)),
      );
    },
    [],
  );

  // Works on the note's latest text, so an upload finishing late can't undo typing done meanwhile,
  // even after switching to another note.
  const replaceInNote = useCallback((id: string, search: string, replacement: string) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === id && note.content.includes(search)
          ? // A function, so a "$" in the replacement (an image named "$&.png") is taken literally.
            { ...note, content: note.content.replace(search, () => replacement), updatedAt: Date.now() }
          : note,
      ),
    );
  }, []);

  const markFailed = useCallback((id: string, isFailed: boolean) => {
    setFailed((prev) => {
      if (prev.has(id) === isFailed) return prev;
      const next = new Set(prev);
      if (isFailed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Gone from the window at once; if the database turns the delete down, the note comes back
  // and the promise rejects so the caller can say so.
  const deleteNote = useCallback(async (id: string): Promise<void> => {
    const index = notesRef.current.findIndex((note) => note.id === id);
    const note = notesRef.current[index];
    if (!note) return;
    const wasSaved = savedRef.current[id];
    setNotes((prev) => prev.filter((candidate) => candidate.id !== id));
    setSaved((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // A note the database never had has nothing to delete there.
    if (wasSaved === undefined) return;
    try {
      await deleteNoteRemote(id);
    } catch (cause) {
      // Already deleted, from another window: that's what was wanted.
      if (cause instanceof ApiError && cause.status === 404) return;
      setNotes((prev) =>
        prev.some((candidate) => candidate.id === id) ? prev : [...prev.slice(0, index), note, ...prev.slice(index)],
      );
      setSaved((prev) => ({ ...prev, [id]: wasSaved }));
      throw cause;
    }
  }, []);

  const persistNote = useCallback(async (id: string): Promise<void> => {
    const note = notesRef.current.find((candidate) => candidate.id === id);
    if (!note) return;
    setSavingId(id);
    markFailed(id, false);
    try {
      // The stored copy this window last saw, so a newer one from another window isn't overwritten.
      const { note: stored } = await saveNote(note, savedRef.current[id] ?? null);
      setSaved((prev) => ({ ...prev, [id]: note.updatedAt }));
      // Skip the swap if the note was edited while the save was in flight, or those keystrokes would be lost.
      setNotes((prev) => prev.map((n) => (n.id === id && n.updatedAt === note.updatedAt ? stored : n)));
    } catch (cause) {
      markFailed(id, true);
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict({ noteId: id, theirs: (cause.data.note as Note | null | undefined) ?? null });
      } else {
        reportSaveFailure(id, cause);
      }
    } finally {
      setSavingId((prev) => (prev === id ? null : prev));
    }
  }, [markFailed, reportSaveFailure]);

  // How a conflict ends: this window's text replaces the other ("mine"), the other window's
  // replaces this one ("theirs"), or this window's text goes into a new note and the original
  // takes the other window's text ("both"). null leaves it unsaved, to decide later.
  const resolveConflict = useCallback(
    async (choice: ConflictChoice | null): Promise<void> => {
      const current = conflict;
      setConflict(null);
      if (!current || choice === null) return;
      const { noteId, theirs } = current;
      const mine = notesRef.current.find((note) => note.id === noteId);
      if (!mine) return;

      if (choice === "mine") {
        // Saved against the copy stored now, so this save goes through.
        const next = { ...savedRef.current };
        if (theirs) next[noteId] = theirs.updatedAt;
        else delete next[noteId];
        savedRef.current = next;
        setSaved(next);
        await persistNote(noteId);
        return;
      }

      if (choice === "both") {
        const now = Date.now();
        const copy: Note = {
          ...mine,
          id: crypto.randomUUID(),
          title: `${mine.title.trim() || "Untitled"} (from this window)`,
          position: nextPosition(notesRef.current, mine.groupId),
          createdAt: now,
          updatedAt: now,
        };
        notesRef.current = [copy, ...notesRef.current];
        setNotes((prev) => [copy, ...prev]);
        void persistNote(copy.id);
      }

      markFailed(noteId, false);
      if (theirs) {
        setNotes((prev) => prev.map((note) => (note.id === noteId ? theirs : note)));
        setSaved((prev) => ({ ...prev, [noteId]: theirs.updatedAt }));
      } else {
        // Deleted in the other window: this window's copy stays, unsaved, to keep or delete.
        setSaved((prev) => {
          const next = { ...prev };
          delete next[noteId];
          return next;
        });
      }
    },
    [conflict, markFailed, persistNote],
  );

  const saveStateOf = useCallback(
    (note: Note): SaveState => {
      if (savingId === note.id) return "saving";
      if (failed.has(note.id)) return "error";
      return saved[note.id] === note.updatedAt ? "saved" : "dirty";
    },
    [savingId, failed, saved],
  );

  return {
    allNotes: notes,
    recentNotes,
    loaded,
    createNote,
    updateNote,
    replaceInNote,
    deleteNote,
    persistNote,
    moveNote,
    placeNotes,
    reassignGroup,
    saveStateOf,
    saveFailure,
    dismissSaveFailure,
    conflict,
    resolveConflict,
    offlineCopyFailed,
  };
}
