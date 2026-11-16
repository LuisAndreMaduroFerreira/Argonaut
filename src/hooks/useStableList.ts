import { useRef } from "react";

// The previous list while every item still matches the new one by `same`, so what is computed
// from a list (or drawn from it) is left alone when only things it doesn't read have changed.
// Typing in a note changes its text on every key, which needn't redraw the sidebar or re-scan
// every other note for links.
export function useStableList<L extends readonly unknown[]>(list: L, same: (a: L[number], b: L[number]) => boolean): L {
  const previous = useRef(list);
  const old = previous.current;
  if (old !== list && (old.length !== list.length || list.some((item, index) => !same(old[index], item)))) {
    previous.current = list;
  }
  return previous.current;
}
