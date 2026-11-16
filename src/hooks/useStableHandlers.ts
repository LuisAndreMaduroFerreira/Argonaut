import { useRef } from "react";
import { useLatest } from "./useLatest";

type Handler = (...args: never[]) => unknown;

// Functions that keep their identity from render to render and always call the latest version
// of what was passed, so a memoised component that takes many callbacks isn't redrawn just
// because its parent made new ones. The set of names must stay the same.
export function useStableHandlers<T extends Record<string, Handler>>(handlers: T): T {
  const latest = useLatest(handlers);
  const stable = useRef<T | null>(null);
  if (stable.current === null) {
    const entries = Object.keys(handlers).map((name) => [
      name,
      (...args: unknown[]) => (latest.current[name] as unknown as (...args: unknown[]) => unknown)(...args),
    ]);
    stable.current = Object.fromEntries(entries) as T;
  }
  return stable.current;
}
