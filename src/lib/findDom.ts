// Find in a rendered pane (Preview, a final view, Missions, Tests, Shortcuts): the visible text
// is read into one string, searched like a note, and matches are painted with the CSS Custom
// Highlight API, so the page itself is never changed.

import type { FindMatch } from "./find";

interface Piece {
  node: Text;
  start: number;
  end: number;
}

export interface DomText {
  text: string;
  pieces: Piece[];
}

const MATCH_HIGHLIGHT = "argonaut-find";
const CURRENT_HIGHLIGHT = "argonaut-find-current";

// What's searched on the pane shown now: a note's or a work's rendered text if there is one,
// otherwise everything in the pane. Hidden panes (the Tests tab kept alive) are skipped.
export function findRoot(pane: HTMLElement | null): HTMLElement | null {
  if (!pane) return null;
  const scroller = [...pane.querySelectorAll<HTMLElement>(".editor-scroll")].find(
    (element) => !element.closest("[hidden]"),
  );
  return scroller?.querySelector<HTMLElement>(".markdown-preview") ?? scroller ?? null;
}

function visible(element: Element): boolean {
  if (element.closest("[hidden], [aria-hidden='true'], .visually-hidden, script, style, textarea, input, select")) {
    return false;
  }
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility({ checkVisibilityCSS: true })
    : element.getClientRects().length > 0;
}

// Text from different blocks is joined with a line break, so a match can't run from the end of
// one paragraph into the next, and ^ and $ work per line.
export function readDomText(root: HTMLElement): DomText {
  const blockOf = new Map<Element, Element>();
  const block = (element: Element): Element => {
    const known = blockOf.get(element);
    if (known) return known;
    let found: Element = root;
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
      const display = getComputedStyle(current).display;
      if (display !== "inline" && display !== "contents") {
        found = current;
        break;
      }
    }
    blockOf.set(element, found);
    return found;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: Piece[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent || node.data === "" || !visible(parent)) continue;
    const here = block(parent);
    if (lastBlock && here !== lastBlock && !text.endsWith("\n")) text += "\n";
    lastBlock = here;
    pieces.push({ node, start: text.length, end: text.length + node.data.length });
    text += node.data;
  }
  return { text, pieces };
}

// The piece holding a position: the first one ending after it, or the last one for the end.
function pieceAt(pieces: Piece[], offset: number): number {
  let low = 0;
  let high = pieces.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (pieces[middle]!.end <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function rangeFor(dom: DomText, match: FindMatch): Range | null {
  if (dom.pieces.length === 0) return null;
  const first = dom.pieces[pieceAt(dom.pieces, match.start)]!;
  // A position on a joining line break belongs to the start of the next piece.
  const startOffset = Math.max(0, Math.min(match.start - first.start, first.node.data.length));
  const range = document.createRange();
  range.setStart(first.node, match.start < first.start ? 0 : startOffset);
  if (match.end === match.start) {
    range.collapse(true);
    return range;
  }
  const last = dom.pieces[pieceAt(dom.pieces, Math.max(match.start, match.end - 1))]!;
  range.setEnd(last.node, Math.max(0, Math.min(match.end - last.start, last.node.data.length)));
  return range;
}

function registry(): HighlightRegistry | null {
  return typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null;
}

export function paintDomMatches(ranges: Range[], current: Range | null): void {
  const highlights = registry();
  if (!highlights) return;
  highlights.set(MATCH_HIGHLIGHT, new Highlight(...ranges));
  if (current) {
    const emphasis = new Highlight(current);
    emphasis.priority = 1;
    highlights.set(CURRENT_HIGHLIGHT, emphasis);
  } else {
    highlights.delete(CURRENT_HIGHLIGHT);
  }
}

export function clearDomMatches(): void {
  const highlights = registry();
  highlights?.delete(MATCH_HIGHLIGHT);
  highlights?.delete(CURRENT_HIGHLIGHT);
}

// Scrolls the page around `inside` so the rectangle sits in the middle of it, when it isn't
// comfortably in view already.
function revealRect(rect: DOMRect, inside: Element): void {
  const scroller = inside.closest<HTMLElement>(".editor-scroll");
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const margin = Math.min(80, box.height / 4);
  if (rect.top >= box.top + margin && rect.bottom <= box.bottom - margin) return;
  scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
}

export function revealRange(range: Range, root: HTMLElement): void {
  revealRect(range.getBoundingClientRect(), root);
}

export function revealElement(element: Element): void {
  revealRect(element.getBoundingClientRect(), element);
}
