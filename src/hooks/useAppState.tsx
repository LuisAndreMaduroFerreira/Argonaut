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
import { fetchAppState, patchAppState } from "../lib/appStateApi";
import { readStorage, writeStorage } from "../lib/storage";
import { sanitizeState, type AppState, type StateKey } from "../../shared/appState";

interface AppStateContextValue extends AppState {
  // True once the server copy has loaded, or failed to (offline).
  ready: boolean;
  // Whether a workspace was ever saved; false means a first run with nothing to restore.
  workspaceStored: boolean;
  patch: <K extends StateKey>(key: K, fields: Partial<AppState[K]>) => void;
  get: <K extends StateKey>(key: K) => AppState[K];
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

const CACHE_KEY = "knowledge-vault.appState";
const FLUSH_DELAY_MS = 400;

function defaultState(): AppState {
  // Earlier versions kept these in localStorage directly; they seed a first run.
  return {
    workspace: { openNoteIds: [], openPaperIds: [], activeTab: null, missionCadence: "DAILY" },
    preferences: {
      theme: readStorage("knowledge-vault.theme") === "light" ? "light" : "dark",
      voiceURI: readStorage("knowledge-vault.voiceURI") ?? "",
      missionBriefingDay: readStorage("knowledge-vault.missionBriefing"),
      panelOpen: true,
      panelTab: "assistant",
      collapsedGroups: [],
      collapsedSections: [],
    },
  };
}

// Server values win, except for fields the user already changed in this window.
function mergeRemote<T extends object>(local: T, remote: Partial<T> | null, touched: Set<string>): Partial<T> {
  if (!remote) return local;
  const next = { ...local } as Record<string, unknown>;
  for (const [field, value] of Object.entries(remote)) {
    if (!touched.has(field) && Object.hasOwn(local, field)) next[field] = value;
  }
  return next as Partial<T>;
}

function readInitialState(): { state: AppState; workspaceStored: boolean } {
  const defaults = defaultState();
  const raw = readStorage(CACHE_KEY);
  if (!raw) return { state: defaults, workspaceStored: false };
  try {
    const cached = JSON.parse(raw) as Partial<AppState> & { workspaceStored?: boolean };
    return {
      state: {
        workspace: sanitizeState("workspace", cached.workspace, defaults.workspace),
        preferences: sanitizeState("preferences", cached.preferences, defaults.preferences),
      },
      workspaceStored: cached.workspaceStored === true,
    };
  } catch {
    return { state: defaults, workspaceStored: false };
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readInitialState);
  const [state, setState] = useState<AppState>(initial.state);
  const [workspaceStored, setWorkspaceStored] = useState(initial.workspaceStored);
  const [ready, setReady] = useState(false);

  // `latest` is updated synchronously, so consecutive patches in one event never read stale state.
  const latest = useRef(initial.state);
  const pending = useRef<Record<StateKey, Set<string>>>({ workspace: new Set(), preferences: new Set() });
  const touched = useRef<Record<StateKey, Set<string>>>({ workspace: new Set(), preferences: new Set() });
  const timers = useRef<Partial<Record<StateKey, number>>>({});

  const commit = useCallback((next: AppState) => {
    latest.current = next;
    setState(next);
  }, []);

  const flush = useCallback((key: StateKey, keepalive = false) => {
    window.clearTimeout(timers.current[key]);
    const fields = [...pending.current[key]];
    if (fields.length === 0) return;
    pending.current[key].clear();

    const values = latest.current[key] as unknown as Record<string, unknown>;
    patchAppState(key, Object.fromEntries(fields.map((field) => [field, values[field]])), keepalive).catch(() => {
      // Offline or API down: keep the fields pending so the next change retries them.
      fields.forEach((field) => pending.current[key].add(field));
    });
  }, []);

  const patch = useCallback(
    <K extends StateKey>(key: K, fields: Partial<AppState[K]>) => {
      const current = latest.current;
      commit({ ...current, [key]: { ...current[key], ...fields } } as AppState);
      for (const field of Object.keys(fields)) {
        pending.current[key].add(field);
        touched.current[key].add(field);
      }
      if (key === "workspace") setWorkspaceStored(true);
      window.clearTimeout(timers.current[key]);
      timers.current[key] = window.setTimeout(() => flush(key), FLUSH_DELAY_MS);
    },
    [commit, flush],
  );

  const get = useCallback(<K extends StateKey>(key: K): AppState[K] => latest.current[key], []);

  useEffect(() => {
    let cancelled = false;
    fetchAppState()
      .then((remote) => {
        if (cancelled) return;
        const current = latest.current;
        commit({
          workspace: sanitizeState(
            "workspace",
            mergeRemote(current.workspace, remote.workspace, touched.current.workspace),
            current.workspace,
          ),
          preferences: sanitizeState(
            "preferences",
            mergeRemote(current.preferences, remote.preferences, touched.current.preferences),
            current.preferences,
          ),
        });
        if (remote.workspace) setWorkspaceStored(true);
      })
      .catch(() => {
        // Offline: keep working from the cached copy.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [commit]);

  useEffect(() => {
    writeStorage(CACHE_KEY, JSON.stringify({ ...state, workspaceStored }));
  }, [state, workspaceStored]);

  // Closing the window inside the debounce delay must not drop the last change.
  useEffect(() => {
    const flushAll = () => {
      flush("workspace", true);
      flush("preferences", true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flush]);

  const value = useMemo(
    () => ({ ...state, ready, workspaceStored, patch, get }),
    [state, ready, workspaceStored, patch, get],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState must be used inside AppStateProvider");
  return context;
}
