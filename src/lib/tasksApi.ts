import type { BoardUpdate, Cadence, TaskBoard, TaskDraft, TextFields } from "../types";
import { apiFetch } from "./api";

export function fetchBoard(): Promise<TaskBoard> {
  return apiFetch<TaskBoard>("/api/tasks");
}

export function createTask(draft: TaskDraft): Promise<BoardUpdate> {
  return apiFetch("/api/tasks", { method: "POST", body: JSON.stringify(draft) });
}

export function updateTask(
  id: string,
  patch: Partial<TextFields & { cadence: Cadence; repeats: boolean }>,
): Promise<BoardUpdate> {
  return apiFetch(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function removeTask(id: string): Promise<BoardUpdate> {
  return apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
}

export function setTaskDone(id: string, done: boolean): Promise<BoardUpdate> {
  return apiFetch(`/api/tasks/${id}/done`, { method: "PUT", body: JSON.stringify({ done }) });
}

export function addSubtask(taskId: string, draft: TextFields): Promise<BoardUpdate> {
  return apiFetch(`/api/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify(draft) });
}

export function updateSubtask(id: string, patch: Partial<TextFields>): Promise<BoardUpdate> {
  return apiFetch(`/api/subtasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function removeSubtask(id: string): Promise<BoardUpdate> {
  return apiFetch(`/api/subtasks/${id}`, { method: "DELETE" });
}

export function setSubtaskDone(id: string, done: boolean): Promise<BoardUpdate> {
  return apiFetch(`/api/subtasks/${id}/done`, { method: "PUT", body: JSON.stringify({ done }) });
}
