import { useSyncExternalStore } from "react";

// wide: sidebar, document and side panel side by side.
// medium: sidebar and document; the side panel opens over the document.
// narrow: the document alone; navigation and the side panel open over it.
// The side panels give way before the document's reading column has to shrink.
export type LayoutMode = "wide" | "medium" | "narrow";

const WIDE = "(min-width: 1360px)";
const MEDIUM = "(min-width: 960px)";

function current(): LayoutMode {
  if (window.matchMedia(WIDE).matches) return "wide";
  return window.matchMedia(MEDIUM).matches ? "medium" : "narrow";
}

// Several signals, because not every way of resizing a window fires every one of them:
// minimising and restoring, zoom, and a window drawn while hidden can each skip some.
function subscribe(onChange: () => void): () => void {
  const queries = [window.matchMedia(WIDE), window.matchMedia(MEDIUM)];
  const observer = new ResizeObserver(onChange);
  queries.forEach((query) => query.addEventListener("change", onChange));
  window.addEventListener("resize", onChange);
  document.addEventListener("visibilitychange", onChange);
  observer.observe(document.documentElement);
  return () => {
    queries.forEach((query) => query.removeEventListener("change", onChange));
    window.removeEventListener("resize", onChange);
    document.removeEventListener("visibilitychange", onChange);
    observer.disconnect();
  };
}

// Read live on every render, so the layout can never lag behind the window's real width.
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, current);
}
