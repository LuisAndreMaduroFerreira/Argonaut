export type Verdict = "correct" | "accents" | "wrong";

// Case, spacing, curly quotes and a trailing full stop don't matter; accents do.
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;:,]+$/, "")
    .trim();
}

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// A missing or wrong accent (a for à) is still a mistake when learning a language, but a
// different one from not knowing the word, so it gets its own verdict.
export function gradeOpen(accepted: string[], given: string): Verdict {
  const answer = normalizeAnswer(given);
  const normalized = accepted.map(normalizeAnswer);
  if (normalized.includes(answer)) return "correct";
  if (normalized.map(withoutAccents).includes(withoutAccents(answer))) return "accents";
  return "wrong";
}

export function gradeChoice(correct: string[], chosen: string[]): Verdict {
  return correct.length === chosen.length && correct.every((option) => chosen.includes(option)) ? "correct" : "wrong";
}

export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
