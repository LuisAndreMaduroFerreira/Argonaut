import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  // Where the key goes, passed in from .env so the setup steps can point at the exact file.
  settingsFile: string;
}

// Everything the API is told from outside, read once at start-up. Tests build their own.
export interface AppConfig {
  llm: LlmSettings;
  // Where the spell checker answers: the argonaut-spell container.
  spellUrl: string;
  // Where speech is turned into text: the argonaut-whisper container.
  whisperUrl: string;
  // Pages on another origin that may call the API: the Vite dev server of `npm run dev`.
  devOrigins: string[];
  // The built web app, served on the API's own port; null when there isn't one, as during
  // `npm run dev`, where Vite serves it instead.
  publicDir: string | null;
}

const DEV_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";

// docker-compose passes a variable that .env doesn't set as an empty string, so an empty
// value counts as not set. DEV_ORIGINS is the exception: empty means no dev server may call.
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  return {
    llm: {
      baseUrl: env.LLM_BASE_URL || "https://routellm.abacus.ai/v1",
      apiKey: env.LLM_API_KEY ?? "",
      model: env.LLM_MODEL || "route-llm",
      settingsFile: env.SETTINGS_FILE ?? "",
    },
    spellUrl: env.SPELL_URL || "http://localhost:8790",
    whisperUrl: env.WHISPER_URL || "http://localhost:8792",
    devOrigins: (env.DEV_ORIGINS ?? DEV_ORIGINS)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    publicDir: existsSync(publicDir) ? publicDir : null,
  };
}
