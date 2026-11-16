import type { ReactNode } from "react";

// A little formatting for test questions, options and explanations: `inline code`, and code
// blocks between ``` fences. Everything else stays plain text, so an imported file can never
// put markup on the page.

export function inlineCode(text: string): ReactNode[] {
  return text
    .split(/(`[^`\n]+`)/g)
    .map((part, index) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}

export interface Segment {
  kind: "text" | "code";
  body: string;
}

// Text and code blocks in order; a fence may name a language (```rust), which is dropped.
export function segments(text: string): Segment[] {
  const parts: Segment[] = [];
  const fence = /```[\w+-]*[ \t]*\n?([\s\S]*?)```/g;
  let last = 0;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    if (match.index > last) parts.push({ kind: "text", body: text.slice(last, match.index) });
    parts.push({ kind: "code", body: match[1]!.replace(/\n$/, "") });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", body: text.slice(last) });
  return parts
    .map((part) => (part.kind === "text" ? { ...part, body: part.body.trim() } : part))
    .filter((part) => part.body !== "");
}

// Segments after the first, for text that leads with a heading (a test question's prompt).
export function RichRest({ parts, className }: { parts: Segment[]; className: string }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "code" ? (
          <pre key={index} className="test-code">
            <code>{part.body}</code>
          </pre>
        ) : (
          <p key={index} className={className}>
            {inlineCode(part.body)}
          </p>
        ),
      )}
    </>
  );
}

export function RichText({ text, className }: { text: string; className: string }) {
  return <RichRest parts={segments(text)} className={className} />;
}
