import type { BoardUpdate, GenerateOptions, TestDetail, TestFolder, TestResponse, TestSummary } from "../types";
import { apiFetch } from "./api";

export function fetchTests(): Promise<TestSummary[]> {
  return apiFetch<TestSummary[]>("/api/tests");
}

export function fetchTestFolders(): Promise<TestFolder[]> {
  return apiFetch<TestFolder[]>("/api/test-folders");
}

export function fetchTest(id: string): Promise<TestDetail> {
  return apiFetch<TestDetail>(`/api/tests/${id}`);
}

export interface ImportResult {
  imported: number;
  questions: number;
  // The Tests folder the batch went into, and the weekly mission made for it.
  folder: TestFolder;
  mission: string;
  tests: TestSummary[];
  folders: TestFolder[];
  board: BoardUpdate["board"];
}

export function importTests(payload: unknown): Promise<ImportResult> {
  return apiFetch("/api/tests/import", { method: "POST", body: JSON.stringify(payload) });
}

export function removeTest(id: string): Promise<TestSummary[]> {
  return apiFetch(`/api/tests/${id}`, { method: "DELETE" });
}

export function renameTestFolder(id: string, name: string): Promise<TestFolder[]> {
  return apiFetch(`/api/test-folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

// The folder goes; its tests move to the top of the Tests section.
export function deleteTestFolder(id: string): Promise<{ folders: TestFolder[]; tests: TestSummary[] }> {
  return apiFetch(`/api/test-folders/${id}`, { method: "DELETE" });
}

export interface GeneratedTest {
  id: string;
  title: string;
  questions: number;
  notesUsed: number;
  // True when the notes were too long to send whole.
  truncated: boolean;
  tests: TestSummary[];
}

export function generateTest(options: GenerateOptions, signal?: AbortSignal): Promise<GeneratedTest> {
  // The server allows the assistant two tries of up to three minutes each.
  return apiFetch("/api/tests/generate", { method: "POST", body: JSON.stringify(options), signal }, { timeoutMs: 400_000 });
}

// The update is there when the run was all correct and that ticked the test's mission subtask.
export function recordAttempt(
  id: string,
  responses: TestResponse[],
): Promise<{ tests: TestSummary[]; update: BoardUpdate | null }> {
  return apiFetch(`/api/tests/${id}/attempts`, { method: "POST", body: JSON.stringify({ responses }) });
}
