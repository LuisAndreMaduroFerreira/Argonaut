import { InputError } from "./errors.js";

export { isUuid } from "../../shared/model.js";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asObject(body: unknown, message = "Expected an object"): Record<string, unknown> {
  if (!isObject(body)) throw new InputError(message);
  return body;
}

// One line of text: runs of whitespace, line breaks included, become a single space. `label`
// is how the messages name the field: "Title", or '"title"' for a field of a JSON body.
// Whether an empty line is allowed is the caller's business.
export function readLine(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new InputError(`${label} must be text`);
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length > max) throw new InputError(`${label} can be at most ${max} characters`);
  return line;
}
