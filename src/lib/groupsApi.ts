import type { NoteGroup, Section } from "../types";
import { apiFetch } from "./api";

export function fetchGroups(): Promise<NoteGroup[]> {
  return apiFetch<NoteGroup[]>("/api/groups");
}

// A top-level group needs its section; a subgroup takes its parent's.
export function createGroupRemote(
  name: string,
  parentId: string | null,
  section: Section,
): Promise<{ group: NoteGroup; groups: NoteGroup[] }> {
  return apiFetch("/api/groups", { method: "POST", body: JSON.stringify({ name, parentId, section }) });
}

export function renameGroupRemote(id: string, name: string): Promise<NoteGroup[]> {
  return apiFetch(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

// Into another group, or to the top level of a section when parentId is null.
export function moveGroupRemote(id: string, parentId: string | null, section: Section): Promise<NoteGroup[]> {
  return apiFetch(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify({ parentId, section }) });
}

// What the group held moves up to its parent, which the answer names.
export function deleteGroupRemote(id: string): Promise<{ parentId: string | null; groups: NoteGroup[] }> {
  return apiFetch(`/api/groups/${id}`, { method: "DELETE" });
}

// A group's notes (or the top level's, for null) in their new order, all filed there.
export function orderNotesRemote(groupId: string | null, noteIds: string[]): Promise<void> {
  return apiFetch<void>("/api/notes/order", { method: "PUT", body: JSON.stringify({ groupId, noteIds }) });
}
