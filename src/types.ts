// The model the web app shares with the API (see shared/model.ts), and beside it the types
// only the web app needs.
import type { TaskFeedback } from "../shared/model";

export * from "../shared/model";

export type ViewMode = "edit" | "preview";

export type SpeechStatus = "idle" | "speaking" | "paused";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export type SaveState = "saved" | "dirty" | "saving" | "error";

export type ToastContent =
  | TaskFeedback
  | { kind: "briefing"; done: number; total: number; endsAt: string }
  | { kind: "error"; message: string };
