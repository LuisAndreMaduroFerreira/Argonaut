import { useCallback, useEffect, useState } from "react";
import { fetchAssistantStatus } from "../lib/assistantClient";
import type { AssistantStatus } from "../types";

// null until the first answer; an unreachable API counts as not configured.
export function useAssistantStatus() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);

  const refresh = useCallback(async (): Promise<AssistantStatus> => {
    const next = await fetchAssistantStatus().catch(() => ({ configured: false, model: "", settingsFile: "" }));
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, refresh };
}
