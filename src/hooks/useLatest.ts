import { useLayoutEffect, useRef, type MutableRefObject } from "react";

// The latest value of something a long-lived listener or a late callback needs, without
// setting the listener up again every time the value changes. Read `.current` when the event
// arrives, never while rendering.
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
