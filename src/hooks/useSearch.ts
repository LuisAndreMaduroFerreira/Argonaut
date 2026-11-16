import { useMemo, useState } from "react";
import { effectiveGroupId, groupLabel } from "../lib/groups";
import type { Note, NoteGroup, Paper, PaperFolder } from "../types";

// The sidebar's search box. Notes are found by title, text, tags and the names of the groups
// they're in; papers by title, authors, DOI, file name or folder. Both lists are null while
// nothing is searched for.
export function useSearch(notes: Note[], groups: NoteGroup[], papers: Paper[] | null, folders: PaperFolder[]) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();

  const noteResults = useMemo(() => {
    if (!term) return null;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(term) ||
        note.content.toLowerCase().includes(term) ||
        note.tags.some((tag) => tag.toLowerCase().includes(term)) ||
        groupLabel(groups, effectiveGroupId(note, groups)).toLowerCase().includes(term),
    );
  }, [notes, groups, term]);

  const paperResults = useMemo(() => {
    if (!term || !papers) return null;
    const folderName = new Map(folders.map((folder) => [folder.id, folder.name.toLowerCase()]));
    return papers.filter((paper) =>
      [paper.title, paper.authors, paper.doi, paper.fileName, folderName.get(paper.folderId ?? "") ?? ""].some((field) =>
        field.toLowerCase().includes(term),
      ),
    );
  }, [papers, folders, term]);

  return { query, setQuery, noteResults, paperResults };
}
