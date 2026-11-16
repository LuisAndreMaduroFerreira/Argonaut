import { useId, useRef, useState, type CSSProperties } from "react";
import { LIMITS } from "../types";
import { Icon } from "./Icon";
import { errorMessage } from "../lib/api";

interface NameBoxProps {
  initial?: string;
  depth: number;
  label: string;
  onSubmit: (name: string) => Promise<unknown>;
  // fromKeyboard: the box closed by Enter or Escape, so focus should go back where it came from.
  onDone: (fromKeyboard: boolean) => void;
}

// Typing a folder's name in the sidebar: Enter keeps it, Escape or an empty box leaves things
// as they were, and clicking away keeps it unless it was just refused.
export function NameBox({ initial = "", depth, label, onSubmit, onDone }: NameBoxProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Set once the box is done with, so a blur arriving as it closes can't submit it again.
  const finished = useRef(false);
  const errorId = useId();

  const finish = (fromKeyboard: boolean) => {
    finished.current = true;
    onDone(fromKeyboard);
  };

  const submit = async (fromKeyboard: boolean) => {
    if (finished.current || busy.current) return;
    const name = value.trim();
    if (!name || name === initial) {
      finish(fromKeyboard);
      return;
    }
    busy.current = true;
    try {
      await onSubmit(name);
      finish(fromKeyboard);
    } catch (cause) {
      busy.current = false;
      setError(errorMessage(cause));
    }
  };

  return (
    <div className="nav-group-edit" style={{ "--depth": depth } as CSSProperties} data-own-escape>
      <Icon name="folder" size={16} />
      <input
        autoFocus
        className="nav-group-input"
        value={value}
        maxLength={LIMITS.folderName}
        placeholder="Name"
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(true);
          }
        }}
        onBlur={() => {
          if (finished.current) return;
          if (error) finish(false);
          else void submit(false);
        }}
      />
      {error && (
        <p id={errorId} className="nav-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
