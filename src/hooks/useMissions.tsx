import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BoardUpdate, TaskBoard, ToastContent } from "../types";
import { fetchBoard } from "../lib/tasksApi";
import { useAppState } from "./useAppState";
import { useResource } from "./useResource";

export interface Toast {
  id: string;
  content: ToastContent;
}

interface MissionsContextValue {
  board: TaskBoard | null;
  boardError: string | null;
  toasts: Toast[];
  refresh: () => Promise<void>;
  apply: (update: BoardUpdate) => void;
  notify: (content: ToastContent) => void;
  dismiss: (id: string) => void;
}

const MissionsContext = createContext<MissionsContextValue | null>(null);

const MAX_TOASTS = 4;
const TOAST_DURATION: Record<ToastContent["kind"], number> = {
  completed: 6500,
  changed: 4000,
  briefing: 6500,
  error: 7000,
};

export function MissionsProvider({ children }: { children: ReactNode }) {
  const { preferences, patch: patchAppState, ready: appStateReady } = useAppState();
  // Periods roll over while the app sits open, so the board is fetched again on focus.
  const { data: board, error: boardError, setData: setBoard, refresh } = useResource(fetchBoard, {
    failure: "Failed to load tasks",
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const briefedRef = useRef(false);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (content: ToastContent) => {
      const toast = { id: crypto.randomUUID(), content };
      setToasts((prev) => [...prev, toast].slice(-MAX_TOASTS));
      window.setTimeout(() => dismiss(toast.id), TOAST_DURATION[content.kind]);
    },
    [dismiss],
  );

  const apply = useCallback(
    ({ board: next, feedback }: BoardUpdate) => {
      setBoard(next);
      feedback.forEach(notify);
    },
    [notify, setBoard],
  );

  // One briefing per day across every window, so wait until the stored day has loaded.
  useEffect(() => {
    if (!board || !appStateReady || briefedRef.current) return;
    briefedRef.current = true;

    const today = board.periods.DAILY.key;
    const daily = board.tasks.filter((task) => task.cadence === "DAILY");
    if (daily.length === 0 || preferences.missionBriefingDay === today) return;

    patchAppState("preferences", { missionBriefingDay: today });
    notify({
      kind: "briefing",
      done: daily.filter((task) => task.done).length,
      total: daily.length,
      endsAt: board.periods.DAILY.endsAt,
    });
  }, [board, appStateReady, preferences.missionBriefingDay, patchAppState, notify]);

  const value = useMemo(
    () => ({ board, boardError, toasts, refresh, apply, notify, dismiss }),
    [board, boardError, toasts, refresh, apply, notify, dismiss],
  );

  return <MissionsContext.Provider value={value}>{children}</MissionsContext.Provider>;
}

export function useMissions(): MissionsContextValue {
  const context = useContext(MissionsContext);
  if (!context) throw new Error("useMissions must be used inside MissionsProvider");
  return context;
}
