import { apiFetch, UPLOAD_TIMEOUT_MS } from "./api";

// Markdown image links that point at images stored with the notes.
export const STORED_IMAGE = /!\[([^\]]*)\]\((\/api\/attachments\/[0-9a-f-]{36})\)/gi;

export function uploadImage(file: File, noteId: string): Promise<{ id: string; url: string }> {
  return apiFetch("/api/attachments", {
    method: "POST",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-Note-Id": noteId,
    },
  }, { timeoutMs: UPLOAD_TIMEOUT_MS });
}
