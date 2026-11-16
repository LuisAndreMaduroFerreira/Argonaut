import { useCallback, useEffect, useState } from "react";
import type { Misspelling, SpellLanguage } from "../types";
import { checkSpelling } from "../lib/spellingApi";

const DELAY_MS = 500;

interface Result {
  // The text these misspellings were found in; they are only shown while it still matches,
  // so a squiggle never sits under the wrong word while you type.
  text: string;
  language: SpellLanguage;
  words: Misspelling[];
}

export function useSpellcheck(text: string, language: string) {
  const [result, setResult] = useState<Result | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (language === "off" || text.trim() === "") {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkSpelling(text, language, controller.signal)
        .then((found) => {
          setResult({ text, language: found.language, words: found.words });
          setUnavailable(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setUnavailable(true);
        });
    }, DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text, language]);

  // Drop a word from the underlines without waiting for the next check.
  const forget = useCallback((word: string) => {
    setResult((current) =>
      current ? { ...current, words: current.words.filter((entry) => entry.word !== word) } : current,
    );
  }, []);

  const current = result?.text === text ? result : null;
  return {
    language: current?.language ?? null,
    words: current?.words ?? [],
    unavailable,
    forget,
  };
}
