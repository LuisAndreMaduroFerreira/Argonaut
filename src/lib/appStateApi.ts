import type { PreferencesState, WorkspaceState } from "../types";
import { apiFetch } from "./api";

export interface RemoteAppState {
  workspace: Partial<WorkspaceState> | null;
  preferences: Partial<PreferencesState> | null;
}

export function fetchAppState(): Promise<RemoteAppState> {
  return apiFetch<RemoteAppState>("/api/state");
}

export function patchAppState(
  key: keyof RemoteAppState,
  fields: Record<string, unknown>,
  keepalive = false,
): Promise<void> {
  return apiFetch<void>(`/api/state/${key}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
    keepalive,
  });
}
