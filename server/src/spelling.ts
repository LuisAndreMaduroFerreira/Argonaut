import { LIMITS, NOTE_LANGUAGES, SPELL_LANGUAGES, type Misspelling, type SpellLanguage } from "../../shared/model.js";
import { pool } from "./db.js";
import { HttpError, InputError } from "./errors.js";

// The dictionaries live in the argonaut-spell container; the words you keep live here, with
// the notes. This module is the seam between the two.

export function isLanguage(value: unknown): value is SpellLanguage {
  return typeof value === "string" && Object.hasOwn(SPELL_LANGUAGES, value);
}

export function isNoteLanguage(value: unknown): value is string {
  return typeof value === "string" && NOTE_LANGUAGES.includes(value);
}

export class SpellerUnavailable extends HttpError {
  constructor() {
    super(503, "The spell checker isn't answering");
  }
}

async function askSpeller<T>(spellUrl: string, path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${spellUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SpellerUnavailable();
  }
  if (!response.ok) throw new SpellerUnavailable();
  return (await response.json()) as T;
}

async function keptWords(language: SpellLanguage): Promise<Set<string>> {
  const result = await pool.query<{ word: string }>("SELECT word FROM kept_words WHERE language = $1", [language]);
  return new Set(result.rows.map((row) => row.word.toLowerCase()));
}

export async function checkText(
  spellUrl: string,
  text: unknown,
  language: unknown,
): Promise<{ language: SpellLanguage; words: Misspelling[] }> {
  if (typeof text !== "string" || text.length > LIMITS.spellText) {
    throw new InputError(`Send text of at most ${LIMITS.spellText} characters`);
  }
  const result = await askSpeller<{ language: SpellLanguage; words: Misspelling[] }>(spellUrl, "/check", {
    text,
    language: isLanguage(language) ? language : undefined,
  });
  const kept = await keptWords(result.language);
  return { language: result.language, words: result.words.filter((entry) => !kept.has(entry.word.toLowerCase())) };
}

export async function suggestFor(spellUrl: string, word: unknown, language: unknown): Promise<string[]> {
  if (typeof word !== "string" || word.length === 0 || word.length > LIMITS.spellWord) {
    throw new InputError("Send a word to get suggestions for");
  }
  if (!isLanguage(language)) throw new InputError("Send a known language");
  const result = await askSpeller<{ suggestions: string[] }>(spellUrl, "/suggest", { word, language });
  return result.suggestions;
}

// "Keep my spelling": the word is never flagged again in that language.
export async function keepWord(word: unknown, language: unknown): Promise<string> {
  if (typeof word !== "string" || word.trim().length === 0 || word.length > LIMITS.spellWord) {
    throw new InputError("Send a word to keep");
  }
  if (!isLanguage(language)) throw new InputError("Send a known language");
  const kept = word.trim();
  await pool.query("INSERT INTO kept_words (language, word) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
    language,
    kept,
  ]);
  return kept;
}
