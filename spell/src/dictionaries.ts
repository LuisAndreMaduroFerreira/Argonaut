import { loadModule, type HunspellFactory } from "hunspell-asm";

export const LANGUAGES = {
  en: "English",
  pt: "Portuguese",
  fr: "French",
  es: "Spanish",
} as const;

export type Language = keyof typeof LANGUAGES;

export interface Misspelling {
  start: number;
  end: number;
  word: string;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

type Checker = ReturnType<HunspellFactory["create"]>;

const DICTIONARIES: Record<Language, () => Promise<{ aff: Uint8Array; dic: Uint8Array }>> = {
  en: async () => (await import("dictionary-en")).default,
  pt: async () => (await import("dictionary-pt")).default,
  fr: async () => (await import("dictionary-fr")).default,
  es: async () => (await import("dictionary-es")).default,
};

// Hunspell compiled to WebAssembly: the four dictionaries together take about 100 MB and load
// in well under a second, so each one is loaded on first use and then kept.
let hunspell: Promise<HunspellFactory> | null = null;
const loaded = new Map<Language, Promise<Checker>>();

export function checkerFor(language: Language): Promise<Checker> {
  const existing = loaded.get(language);
  if (existing) return existing;

  const loading = (async () => {
    hunspell ??= loadModule();
    const factory = await hunspell;
    const dictionary = await DICTIONARIES[language]();
    return factory.create(
      factory.mountBuffer(dictionary.aff, `${language}.aff`),
      factory.mountBuffer(dictionary.dic, `${language}.dic`),
    );
  })();
  loaded.set(language, loading);
  return loading;
}

export function loadedLanguages(): Language[] {
  return [...loaded.keys()];
}

// Notes are Markdown: code, links, images, HTML and wikilink targets aren't prose.
const SKIPPED = [
  /```[\s\S]*?(?:```|$)/g,
  /`[^`\n]*`/g,
  /\]\([^)]*\)/g,
  /\[\[[^\]]*\]\]/g,
  /<[^>\n]+>/g,
  /(?:https?:\/\/|www\.)\S+/gi,
  /\S+@\S+\.\S+/g,
];

const WORD = /\p{L}[\p{L}\p{M}'’-]*/gu;

export function findWords(text: string): Misspelling[] {
  const skip = new Uint8Array(text.length);
  for (const pattern of SKIPPED) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      skip.fill(1, start, start + match[0].length);
    }
  }

  const words: Misspelling[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    if (skip[start] === 1) continue;
    words.push({ start, end: start + match[0].length, word: match[0] });
  }
  return words;
}

// Acronyms and names written in code style (API, camelCase) are left alone: flagging them
// would bury the real mistakes.
function worthChecking(word: string): boolean {
  if (word.length < 2) return false;
  if (word === word.toUpperCase()) return false;
  return !/[A-Z]/.test(word.slice(1));
}

function isCorrect(checker: Checker, word: string): boolean {
  const plain = word.replace(/’/g, "'").replace(/[-']+$/, "");
  if (plain.length === 0 || checker.spell(plain)) return true;

  // Elisions (l'eau, d'accord) are two words wearing one coat.
  const tail = plain.slice(plain.lastIndexOf("'") + 1);
  if (tail !== plain && tail.length > 1 && checker.spell(tail)) return true;

  const lowered = plain.toLowerCase();
  return lowered !== plain && checker.spell(lowered);
}

export async function check(text: string, language: Language, limit = 500): Promise<Misspelling[]> {
  const checker = await checkerFor(language);
  const found: Misspelling[] = [];
  for (const entry of findWords(text)) {
    if (!worthChecking(entry.word) || isCorrect(checker, entry.word)) continue;
    found.push(entry);
    if (found.length >= limit) break;
  }
  return found;
}

export async function suggest(word: string, language: Language, limit = 5): Promise<string[]> {
  const checker = await checkerFor(language);
  return checker.suggest(word.replace(/’/g, "'")).slice(0, limit);
}

// Loading every dictionary at start-up keeps the first check in a note quick.
export async function warmUp(): Promise<void> {
  await Promise.all((Object.keys(LANGUAGES) as Language[]).map((language) => checkerFor(language)));
}

// Everyday words that rarely cross languages, enough to tell a note's language without
// loading a dictionary for each one.
const COMMON: Record<Language, Set<string>> = {
  en: new Set("the and of to in is that it for with this are was be have not on you from they".split(" ")),
  pt: new Set("não uma que com para dos das mais muito também você está são seu sua pelo pela então isso aqui".split(" ")),
  fr: new Set("les des une dans pour avec qui est sont vous nous plus cette mais tout comme aussi ici très alors".split(" ")),
  es: new Set("los las una con para pero muy también está son usted esto aquí entonces porque sus ese hay sin".split(" ")),
};

export function detectLanguage(text: string): Language {
  const words = findWords(text)
    .slice(0, 400)
    .map((entry) => entry.word.toLowerCase());
  if (words.length < 12) return "en";

  let best: Language = "en";
  let bestScore = 0;
  for (const language of Object.keys(COMMON) as Language[]) {
    const score = words.filter((word) => COMMON[language].has(word)).length;
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }
  return bestScore >= Math.max(2, words.length * 0.02) ? best : "en";
}
