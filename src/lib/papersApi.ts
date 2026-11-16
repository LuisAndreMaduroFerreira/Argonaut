import type { Paper, PaperFolder, PaperPatch, PapersState } from "../types";
import { apiFetch, resolveApiUrl, UPLOAD_TIMEOUT_MS } from "./api";

export function fetchPapers(): Promise<PapersState> {
  return apiFetch<PapersState>("/api/papers");
}

// The PDF is sent as it is; the same file sent twice comes back as the paper already holding it.
export function uploadPaper(
  file: File,
  folderId: string | null,
): Promise<PapersState & { paper: Paper; duplicate: boolean }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "X-File-Name": encodeURIComponent(file.name),
  };
  if (folderId) headers["X-Folder-Id"] = folderId;
  return apiFetch("/api/papers", { method: "POST", body: file, headers }, { timeoutMs: UPLOAD_TIMEOUT_MS });
}

export function updatePaper(id: string, patch: PaperPatch): Promise<PapersState> {
  return apiFetch(`/api/papers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deletePaper(id: string): Promise<PapersState> {
  return apiFetch(`/api/papers/${id}`, { method: "DELETE" });
}

export function createPaperFolder(name: string): Promise<PapersState & { folder: PaperFolder }> {
  return apiFetch("/api/paper-folders", { method: "POST", body: JSON.stringify({ name }) });
}

export function renamePaperFolder(id: string, name: string): Promise<PapersState> {
  return apiFetch(`/api/paper-folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deletePaperFolder(id: string): Promise<PapersState> {
  return apiFetch(`/api/paper-folders/${id}`, { method: "DELETE" });
}

// Where the browser's PDF viewer reads the file from.
export function paperFileUrl(id: string): string {
  return resolveApiUrl(`/api/papers/${id}/file`);
}

// Saves the PDF under its own name. Fetched first, since a link's download attribute is
// ignored when the API is on another origin (as it is during development).
export async function downloadPaper(paper: Paper): Promise<void> {
  const response = await fetch(paperFileUrl(paper.id));
  if (!response.ok) throw new Error(`The PDF couldn't be fetched (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = paper.fileName || `${paper.title}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
