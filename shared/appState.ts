import { CADENCES, SIDEBAR_SECTIONS, isUuid, type PreferencesState, type WorkspaceState } from "./model.js";
import { isStoredTabKey } from "./tabs.js";

// Interface state shared by every window: the open tabs, and the preferences.
export interface AppState {
  workspace: WorkspaceState;
  preferences: PreferencesState;
}

export type StateKey = keyof AppState;

export const STATE_KEYS: readonly StateKey[] = ["workspace", "preferences"];

export function isStateKey(value: string): value is StateKey {
  return (STATE_KEYS as readonly string[]).includes(value);
}

type Validator = (value: unknown) => boolean;

const idList =
  (max: number): Validator =>
  (value) =>
    Array.isArray(value) && value.length <= max && value.every(isUuid);

const oneOf =
  (allowed: readonly unknown[]): Validator =>
  (value) =>
    allowed.includes(value);

// What each stored field may hold. The API refuses a patch with anything else, and the web app
// falls back to its default for a field that fails, so both always accept the same values.
export const STATE_FIELDS: { [Key in StateKey]: { [Field in keyof AppState[Key]]: Validator } } = {
  workspace: {
    openNoteIds: idList(50),
    openPaperIds: idList(50),
    activeTab: isStoredTabKey,
    missionCadence: oneOf(CADENCES),
  },
  preferences: {
    theme: oneOf(["light", "dark"]),
    voiceURI: (value) => typeof value === "string" && value.length <= 300,
    missionBriefingDay: (value) => value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)),
    panelOpen: (value) => typeof value === "boolean",
    panelTab: oneOf(["assistant", "history"]),
    collapsedGroups: idList(500),
    collapsedSections: (value) =>
      Array.isArray(value) && value.length <= SIDEBAR_SECTIONS.length && value.every(oneOf(SIDEBAR_SECTIONS)),
  },
};

function fieldsOf(key: StateKey): Record<string, Validator> {
  return STATE_FIELDS[key];
}

// The first problem with a patch of fields, or null when every field is known and valid.
export function patchProblem(key: StateKey, patch: Record<string, unknown>): string | null {
  const fields = fieldsOf(key);
  for (const [field, value] of Object.entries(patch)) {
    const valid = Object.hasOwn(fields, field) ? fields[field] : undefined;
    if (!valid) return `Unknown ${key} field: ${field}`;
    if (!valid(value)) return `Invalid value for ${key}.${field}`;
  }
  return null;
}

// `value` with every missing or invalid field taken from `fallback`.
export function sanitizeState<Key extends StateKey>(key: Key, value: unknown, fallback: AppState[Key]): AppState[Key] {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...fallback };
  for (const [field, valid] of Object.entries(fieldsOf(key))) {
    if (Object.hasOwn(source, field) && valid(source[field])) result[field] = source[field];
  }
  return result as unknown as AppState[Key];
}
