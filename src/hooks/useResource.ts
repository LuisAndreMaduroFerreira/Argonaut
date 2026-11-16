import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { errorMessage } from "../lib/api";
import { useLatest } from "./useLatest";

// Data loaded from the API: fetched on mount, fetched again whenever the window regains focus
// (periods roll over and other windows change things while this one sits in the background),
// and replaced directly by the answers to changes made here.

export interface Resource<T> {
  // null until the first answer.
  data: T | null;
  // What went wrong with the latest fetch, cleared by the next one that works.
  error: string | null;
  // Replaces the data with what a change answered. A fetch already under way can't undo it.
  setData: (next: SetStateAction<T | null>) => void;
  refresh: () => Promise<void>;
}

// One window listener for every resource, rather than one each.
const focusSubscribers = new Set<() => void>();
function onWindowFocus(callback: () => void): () => void {
  if (focusSubscribers.size === 0) window.addEventListener("focus", notifyFocus);
  focusSubscribers.add(callback);
  return () => {
    focusSubscribers.delete(callback);
    if (focusSubscribers.size === 0) window.removeEventListener("focus", notifyFocus);
  };
}
function notifyFocus() {
  focusSubscribers.forEach((callback) => callback());
}

export function useResource<T>(
  load: () => Promise<T>,
  { failure = "Couldn't load", refreshOnFocus = true }: { failure?: string; refreshOnFocus?: boolean } = {},
): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useLatest(load);
  // Bumped by every fetch and every direct change; an answer to an older fetch is dropped.
  const version = useRef(0);

  const refresh = useCallback(async () => {
    version.current += 1;
    const asked = version.current;
    try {
      const next = await loadRef.current();
      if (asked !== version.current) return;
      setDataState(next);
      setError(null);
    } catch (cause) {
      if (asked === version.current) setError(errorMessage(cause, failure));
    }
  }, [loadRef, failure]);

  const setData = useCallback((next: SetStateAction<T | null>) => {
    version.current += 1;
    setDataState(next);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh();
    if (!refreshOnFocus) return;
    return onWindowFocus(() => void refresh());
  }, [refresh, refreshOnFocus]);

  return { data, error, setData, refresh };
}
