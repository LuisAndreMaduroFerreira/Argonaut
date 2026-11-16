// A work's final view: its pages' text joined into one, the way it reads as a book.
//
// Between two pages there's a line break when the first ends a sentence, and just a space
// when the sentence runs on into the next page. A page ending on a dash that splits a word
// or a thought ("well-" / "known", "the man—" / "who") joins with no space at all.

// Closing quotes, brackets and emphasis marks that can follow a sentence's last stop, with
// the space French puts inside guillemets: « Viens. »
const CLOSERS = /["'”’»)\]*_\s]+$/;
// Markdown lines that must start a line of their own: headings, quotes, list items, code,
// and separators.
const BLOCK_LINE = /^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|(?:-\s*){3,}$|(?:\*\s*){3,}$|(?:_\s*){3,}$)/;

function lastLine(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1).trim();
}

export function endsSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed === "") return true;
  // A heading, quote or list item that closes a page is a finished line, stop or no stop.
  if (BLOCK_LINE.test(lastLine(trimmed))) return true;
  const bare = trimmed.replace(CLOSERS, "");
  if (/[.!?…]$/.test(bare)) return true;
  // Speech broken off with a dash inside its closing quote: "I was going to—"
  return bare !== trimmed && /[—–]$/.test(bare);
}

export function joinPages(pages: string[]): string {
  let text = "";
  for (const raw of pages) {
    const page = raw.trim();
    if (page === "") continue;
    if (text === "") text = page;
    else if (endsSentence(text) || BLOCK_LINE.test(page.split("\n", 1)[0]!.trim())) text += `\n${page}`;
    else if (/[\p{L}\p{N}]-$|[—–]$/u.test(text)) text += page;
    else text += ` ${page}`;
  }
  return text;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// "My Book 2026-09-27.md", with anything Windows won't allow in a file name left out.
export function finalViewFileName(name: string, when = new Date()): string {
  const safe =
    name
      // eslint-disable-next-line no-control-regex -- control characters aren't allowed in file names
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/, "")
      .trim() || "Work";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${safe} ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}.md`;
}

// Saved like any browser download, which in the Argonaut window means the Downloads folder.
export function downloadMarkdown(text: string, fileName: string): void {
  const file = new Blob([text.endsWith("\n") ? text : `${text}\n`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
