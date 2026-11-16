import type { AssistantStatus } from "../../shared/model.js";
import type { LlmSettings } from "./config.js";
import { HttpError, InputError } from "./errors.js";
import { isObject } from "./input.js";

export interface NoteContext {
  title: string;
  tags: string[];
  content: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// The assistant: an OpenAI-compatible chat model behind a proxy, reached with the key from .env.
export interface Llm {
  // What the setup steps show: never the key itself, only whether there is one.
  status(): AssistantStatus;
  // One chat completion. A model that can't be reached, or answers badly, is a 502.
  complete(messages: LlmMessage[], timeoutMs?: number): Promise<string>;
  ask(history: ChatTurn[], note: NoteContext | null, tasks: string): Promise<string>;
}

// The note in focus, as the chat request sends it; null for none.
export function parseNoteContext(value: unknown): NoteContext | null {
  if (value === null || value === undefined) return null;
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    typeof value.content !== "string" ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string")
  ) {
    throw new InputError('"note" needs a title, content and a list of tags');
  }
  return { title: value.title, content: value.content, tags: value.tags };
}

function buildSystemPrompt(note: NoteContext | null, tasks: string): string {
  const intro =
    "You are Argonaut, an assistant inside a personal knowledge base and task list. " +
    "Answer briefly and conversationally; your replies are read aloud.";
  const focus = note
    ? `The note currently in focus is titled "${note.title}"` +
      (note.tags.length > 0 ? ` (tags: ${note.tags.join(", ")})` : "") +
      `. Its content follows:\n\n${note.content}`
    : "No note is currently in focus.";
  return `${intro}\n\n${tasks}\n\n${focus}`;
}

export function createLlm({ baseUrl, apiKey, model, settingsFile }: LlmSettings): Llm {
  // .env.example ships a placeholder in angle brackets where the key goes.
  const configured = apiKey.length > 0 && !apiKey.includes("<");

  async function complete(messages: LlmMessage[], timeoutMs = 120_000): Promise<string> {
    if (!configured) throw new HttpError(502, "LLM_API_KEY not configured on the server");

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new HttpError(502, timedOut ? "The assistant took too long to answer" : "The assistant couldn't be reached");
    }
    if (!response.ok) throw new HttpError(502, `Assistant request failed (${response.status})`);

    const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new HttpError(502, "Assistant returned an empty reply");
    }
    return content;
  }

  return {
    status: () => ({ configured, model, settingsFile }),
    complete,
    ask: (history, note, tasks) =>
      complete([
        { role: "system", content: buildSystemPrompt(note, tasks) },
        ...history.map(({ role, content }) => ({ role, content })),
      ]),
  };
}
