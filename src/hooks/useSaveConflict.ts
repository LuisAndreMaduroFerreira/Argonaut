import { useEffect, useRef } from "react";
import type { Note } from "../types";
import type { ConflictChoice, SaveConflict } from "./useNotes";
import { useDialogs } from "./useDialogs";
import { useLatest } from "./useLatest";

// Two windows saved the same note: asks which text to keep, instead of the last save silently
// winning. "Decide later" leaves this window's text unsaved; the next save asks again.
export function useSaveConflict(
  conflict: SaveConflict | null,
  notes: Note[],
  resolve: (choice: ConflictChoice | null) => Promise<void>,
) {
  const { choose } = useDialogs();
  const latest = useLatest({ notes, resolve });
  // Each conflict is asked about once, however often the effect runs.
  const asked = useRef<SaveConflict | null>(null);

  useEffect(() => {
    if (!conflict || asked.current === conflict) return;
    asked.current = conflict;
    const title = latest.current.notes.find((note) => note.id === conflict.noteId)?.title ?? "";
    const name = `“${title.trim() || "Untitled"}”`;
    void choose<ConflictChoice>({
      title: "Changed in another window",
      message: conflict.theirs
        ? `Another window saved ${name} after this one opened it. Which text should the note keep?`
        : `Another window deleted ${name} after this one opened it. Keep this window's text as the note?`,
      cancelLabel: "Decide later",
      choices: conflict.theirs
        ? [
            { key: "theirs", label: "Use the other window's" },
            { key: "both", label: "Keep both" },
            { key: "mine", label: "Keep this window's", primary: true },
          ]
        : [{ key: "mine", label: "Keep it", primary: true }],
    }).then((choice) => latest.current.resolve(choice));
  }, [conflict, choose, latest]);
}
