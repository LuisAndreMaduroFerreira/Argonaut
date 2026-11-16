import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

interface TagInputProps {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  // The note's group, which also counts as a tag. It leads the row, marked as a folder; its ×
  // takes the note out of the group.
  group?: { label: string; onRemove: () => void } | null;
}

function cleanTag(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// New tags go on the end; one already there, in any case, isn't added twice.
function withTags(tags: string[], texts: string[]): string[] {
  const next = [...tags];
  for (const text of texts) {
    const tag = cleanTag(text);
    if (tag && !next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) next.push(tag);
  }
  return next;
}

// Tags as chips. A comma or Enter turns what you typed into a tag, and so does leaving the
// box; the words you're typing stay in a draft of their own until then, so spaces and commas
// never vanish mid-word. Backspace in the empty box takes the last tag back out.
export function TagInput({ id, tags, onChange, group }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const add = (texts: string[]) => {
    const next = withTags(tags, texts);
    if (next.length !== tags.length) onChange(next);
  };

  const commitDraft = () => {
    add([draft]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      event.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div
      className="tag-input"
      // A click on the empty part of the box puts the cursor in it, as with any text box.
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      {group && (
        <span className="chip tag-chip group-chip" title="The group this note is in">
          <Icon name="folder" size={14} />
          <span className="visually-hidden">Group: </span>
          {group.label}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Take the note out of the group ${group.label}`}
            title="Take out of this group"
            onClick={group.onRemove}
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      )}
      {tags.map((tag) => (
        <span key={tag} className="chip tag-chip">
          {tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Remove tag ${tag}`}
            title="Remove tag"
            onClick={() => onChange(tags.filter((other) => other !== tag))}
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        className="tag-input-field"
        value={draft}
        onChange={(event) => {
          // Typed or pasted, every comma closes the tag before it.
          const parts = event.target.value.split(",");
          const rest = parts.pop() ?? "";
          if (parts.length > 0) add(parts);
          setDraft(parts.length > 0 ? rest.trimStart() : rest);
        }}
        onKeyDown={onKeyDown}
        onBlur={commitDraft}
        placeholder={tags.length === 0 ? "Type a tag, then a comma or Enter" : "Add a tag"}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
