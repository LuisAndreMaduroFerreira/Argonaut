import { STATE_KEYS, patchProblem, type StateKey } from "../../shared/appState.js";
import { pool } from "./db.js";
import { InputError } from "./errors.js";
import { isObject } from "./input.js";

// Interface state (open tabs, theme, voice) shared by every window. Each window patches only
// the fields it changed, so writers never overwrite each other. What a field may hold is
// decided by the validators the web app uses too (shared/appState.ts).
export function parsePatch(key: StateKey, body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw new InputError("Expected an object of fields");
  if (Object.keys(body).length === 0) throw new InputError("No fields to update");
  const problem = patchProblem(key, body);
  if (problem) throw new InputError(problem);
  return body;
}

export async function readState(): Promise<Record<StateKey, Record<string, unknown> | null>> {
  const result = await pool.query<{ key: StateKey; value: Record<string, unknown> }>(
    "SELECT key, value FROM app_state WHERE key = ANY($1)",
    [STATE_KEYS],
  );
  const state: Record<StateKey, Record<string, unknown> | null> = { workspace: null, preferences: null };
  for (const row of result.rows) state[row.key] = row.value;
  return state;
}

export async function patchState(key: StateKey, patch: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO app_state (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(patch)],
  );
}
