import { useCallback, useEffect, useState } from "react";
import { useResource } from "./useResource";
import { LIMITS, type Paper, type PaperFolder, type PaperPatch } from "../types";
import {
  createPaperFolder,
  deletePaper,
  deletePaperFolder,
  fetchPapers,
  formatBytes,
  renamePaperFolder,
  updatePaper,
  uploadPaper,
} from "../lib/papersApi";
import { errorMessage } from "../lib/api";

export interface PapersNotice {
  text: string;
  tone: "info" | "error";
}

const quoted = (paper: Paper) => `“${paper.title}”`;

// The papers and their folders, for the sidebar's Papers section and the paper tabs. Each
// change answers with the lists, which replace these.
export function usePapers() {
  const { data, error: loadError, setData: apply, refresh } = useResource(fetchPapers, { failure: "unknown error" });
  const papers: Paper[] | null = data?.papers ?? null;
  const folders: PaperFolder[] = data?.folders ?? [];
  // PDFs still being sent, and what happened to the last ones added.
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<PapersNotice | null>(null);

  // Notices fade after a while; errors stay a little longer.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 12000 : 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Adds PDFs one after another (they can be large), into a folder or none. Returns the papers
  // they became, a file added before included, in the order given.
  const add = useCallback(
    async (files: File[], folderId: string | null): Promise<Paper[]> => {
      const pdfs = files.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
      const fitting = pdfs.filter((file) => file.size <= LIMITS.paperBytes);
      const problems: string[] = [];
      if (pdfs.length < files.length) {
        const other = files.length - pdfs.length;
        problems.push(`${other} ${other === 1 ? "file isn't a PDF" : "files aren't PDFs"}`);
      }
      for (const file of pdfs.filter((candidate) => candidate.size > LIMITS.paperBytes)) {
        problems.push(`${file.name} is ${formatBytes(file.size)}; papers can be at most ${formatBytes(LIMITS.paperBytes)}`);
      }

      const added: Paper[] = [];
      const already: Paper[] = [];
      setUploading((count) => count + fitting.length);
      for (const file of fitting) {
        try {
          const result = await uploadPaper(file, folderId);
          apply(result);
          (result.duplicate ? already : added).push(result.paper);
        } catch (cause) {
          problems.push(`${file.name} couldn't be added: ${errorMessage(cause, "unknown error")}`);
        } finally {
          setUploading((count) => count - 1);
        }
      }

      const parts: string[] = [];
      if (added.length === 1) parts.push(`Added ${quoted(added[0]!)}`);
      else if (added.length > 1) parts.push(`Added ${added.length} papers`);
      if (already.length === 1) parts.push(`${quoted(already[0]!)} was already here`);
      else if (already.length > 1) parts.push(`${already.length} were already here`);
      parts.push(...problems);
      if (parts.length > 0) {
        setNotice({ text: `${parts.join(". ")}.`, tone: problems.length > 0 && added.length === 0 ? "error" : "info" });
      }
      return [...added, ...already];
    },
    [apply],
  );

  const update = useCallback((id: string, patch: PaperPatch) => updatePaper(id, patch).then(apply), [apply]);
  const remove = useCallback((id: string) => deletePaper(id).then(apply), [apply]);
  const createFolder = useCallback(
    (name: string) =>
      createPaperFolder(name).then((result) => {
        apply(result);
        return result.folder;
      }),
    [apply],
  );
  const renameFolder = useCallback((id: string, name: string) => renamePaperFolder(id, name).then(apply), [apply]);
  const deleteFolder = useCallback((id: string) => deletePaperFolder(id).then(apply), [apply]);

  return {
    papers,
    folders,
    loadError,
    uploading,
    notice,
    setNotice,
    refresh,
    add,
    update,
    remove,
    createFolder,
    renameFolder,
    deleteFolder,
  };
}

export type PapersController = ReturnType<typeof usePapers>;
