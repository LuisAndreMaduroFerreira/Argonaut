import { useCallback, useRef, useState } from "react";
import type { ChatMessage, Note } from "../types";
import { askAssistant } from "../lib/assistantClient";
import { useMissions } from "./useMissions";
import { errorMessage } from "../lib/api";

// The conversation lives in memory only. Replies stay in it so follow-up questions have
// context, but they are spoken rather than shown, and nothing survives a refresh.
export function useAssistantChat(note: Note | null) {
  const { apply, notify } = useMissions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string): Promise<string | null> => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return null;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      const history = [...messages, userMessage];
      setMessages(history);
      setError(null);
      setIsThinking(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const answer = await askAssistant(history, note, controller.signal);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: answer.reply },
        ]);
        if (answer.board) apply({ board: answer.board, feedback: answer.feedback });
        for (const message of answer.errors) notify({ kind: "error", message });
        return answer.reply;
      } catch (cause) {
        if (controller.signal.aborted) return null;
        setError(errorMessage(cause, "Request failed"));
        return null;
      } finally {
        setIsThinking(false);
      }
    },
    [messages, note, isThinking, apply, notify],
  );

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsThinking(false);
  }, []);

  return { messages, isThinking, error, sendMessage, clearChat };
}
