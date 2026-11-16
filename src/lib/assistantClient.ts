import type { AssistantStatus, ChatMessage, Note, TaskBoard, TaskFeedback } from "../types";
import { apiFetch } from "./api";

// The server gives the model up to two minutes.
const LLM_TIMEOUT_MS = 150_000;

export interface AssistantAnswer {
  reply: string;
  feedback: TaskFeedback[];
  errors: string[];
  // Present when the reply changed tasks.
  board: TaskBoard | null;
}

export async function fetchAssistantStatus(): Promise<AssistantStatus> {
  const data = await apiFetch<Partial<AssistantStatus>>("/api/chat/status");
  return {
    configured: Boolean(data.configured),
    model: data.model ?? "",
    settingsFile: data.settingsFile ?? "",
  };
}

export async function askAssistant(
  history: ChatMessage[],
  note: Note | null,
  signal?: AbortSignal,
): Promise<AssistantAnswer> {
  const data = await apiFetch<Partial<AssistantAnswer>>("/api/chat", {
    method: "POST",
    signal,
    body: JSON.stringify({
      messages: history.map(({ role, content }) => ({ role, content })),
      note: note ? { title: note.title, tags: note.tags, content: note.content } : null,
    }),
  }, { timeoutMs: LLM_TIMEOUT_MS });

  if (typeof data.reply !== "string" || data.reply.length === 0) {
    throw new Error("Assistant returned an empty reply");
  }
  return {
    reply: data.reply,
    feedback: data.feedback ?? [],
    errors: data.errors ?? [],
    board: data.board ?? null,
  };
}
