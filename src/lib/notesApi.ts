import type { Note } from "../types";
import { apiFetch } from "./api";

// A healthy API stores a note in milliseconds; a save still waiting after this long is stuck
// behind a hung Docker or WSL, and is reported as failed.
const SAVE_TIMEOUT_MS = 15_000;

export function fetchNotes(): Promise<Note[]> {
  return apiFetch<Note[]>("/api/notes");
}

// `baseUpdatedAt` is the stored copy's edit time when this window last saw it (null for a note
// it has never saved). A newer stored copy turns the save down with a 409 carrying that copy.
export function saveNote(note: Note, baseUpdatedAt: number | null): Promise<{ note: Note }> {
  return apiFetch(
    `/api/notes/${note.id}`,
    {
      method: "PUT",
      body: JSON.stringify({ ...note, baseUpdatedAt }),
    },
    { timeoutMs: SAVE_TIMEOUT_MS },
  );
}

export function deleteNoteRemote(id: string): Promise<void> {
  return apiFetch<void>(`/api/notes/${id}`, { method: "DELETE" });
}
