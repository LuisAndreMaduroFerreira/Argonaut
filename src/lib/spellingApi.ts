import type { Misspelling, SpellLanguage } from "../types";
import { apiFetch } from "./api";

export function checkSpelling(
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<{ language: SpellLanguage; words: Misspelling[] }> {
  return apiFetch("/api/spelling/check", {
    method: "POST",
    signal,
    // An empty language asks the checker to work it out from the text.
    body: JSON.stringify({ text, language: language || undefined }),
  });
}

export function suggestSpelling(word: string, language: SpellLanguage): Promise<{ suggestions: string[] }> {
  return apiFetch("/api/spelling/suggest", { method: "POST", body: JSON.stringify({ word, language }) });
}

export function keepSpelling(word: string, language: SpellLanguage): Promise<{ word: string }> {
  return apiFetch("/api/spelling/keep", { method: "POST", body: JSON.stringify({ word, language }) });
}
