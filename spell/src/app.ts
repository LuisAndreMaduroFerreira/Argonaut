// Argonaut's spell checker. It holds the dictionaries and nothing else: no notes, no
// database, no user data. The API container talks to it over the Docker network.
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { LANGUAGES, check, detectLanguage, isLanguage, loadedLanguages, suggest } from "./dictionaries.js";

const MAX_TEXT = 50_000;
const MAX_WORD = 80;

function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, languages: Object.keys(LANGUAGES), loaded: loadedLanguages() });
  });

  // The language may be given, or left out to work it out from the text.
  app.post(
    "/check",
    route(async (req, res) => {
      const { text, language } = req.body ?? {};
      if (typeof text !== "string" || text.length > MAX_TEXT) {
        res.status(400).json({ error: `Send text of at most ${MAX_TEXT} characters` });
        return;
      }
      const chosen = isLanguage(language) ? language : detectLanguage(text);
      res.json({ language: chosen, words: await check(text, chosen) });
    }),
  );

  app.post(
    "/suggest",
    route(async (req, res) => {
      const { word, language } = req.body ?? {};
      if (typeof word !== "string" || word.length === 0 || word.length > MAX_WORD || !isLanguage(language)) {
        res.status(400).json({ error: "Send a word and a known language" });
        return;
      }
      res.json({ suggestions: await suggest(word, language) });
    }),
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({ error: "Spell check failed" });
  });

  return app;
}
