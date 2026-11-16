import { useMemo, type MouseEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { resolveApiUrl } from "../lib/api";
import { findWikilinks } from "../lib/wikilinks";

interface MarkdownPreviewProps {
  markdown: string;
  // Whether a note with this title exists; links to missing notes look different.
  hasNote: (title: string) => boolean;
  onOpenLink: (title: string) => void;
  // Every line break shows, as in a work's final view, where pages meet on a new line.
  breaks?: boolean;
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // Stored images are linked as /api/attachments/<id>; point them at the API's origin.
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src");
    if (src) node.setAttribute("src", resolveApiUrl(src));
    node.setAttribute("loading", "lazy");
  }
  // A web link must never navigate the Argonaut window itself away.
  if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") ?? "")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Each table sits in a wrapper that may spread wider than the text column (.md-table in
// styles/reading.css); otherwise it renders as marked always has.
marked.use({
  renderer: {
    table(token) {
      return `<div class="md-table">${marked.Renderer.prototype.table.call(this, token)}</div>\n`;
    },
  },
});

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function renderWikilinks(markdown: string, hasNote: (title: string) => boolean): string {
  let html = "";
  let index = 0;
  for (const link of findWikilinks(markdown)) {
    const missing = !hasNote(link.target);
    html += markdown.slice(index, link.start);
    html +=
      `<a class="wikilink${missing ? " wikilink-missing" : ""}" href="#" data-target="${escapeHtml(link.target)}"` +
      ` title="${escapeHtml(missing ? `No note called “${link.target}” yet: click to create it` : `Open “${link.target}”`)}">` +
      `${escapeHtml(link.label)}</a>`;
    index = link.end;
  }
  return html + markdown.slice(index);
}

export function MarkdownPreview({ markdown, hasNote, onOpenLink, breaks = false }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    const raw = marked.parse(renderWikilinks(markdown, hasNote), { async: false, breaks });
    return DOMPurify.sanitize(raw);
  }, [markdown, hasNote, breaks]);

  const onClick = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.wikilink");
    if (!link) return;
    event.preventDefault();
    onOpenLink(link.dataset.target ?? "");
  };

  return <article className="markdown-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
