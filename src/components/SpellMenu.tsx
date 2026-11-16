import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SpellLanguage } from "../types";
import { SPELL_LANGUAGES } from "../types";
import { suggestSpelling } from "../lib/spellingApi";

interface SpellMenuProps {
  word: string;
  language: SpellLanguage;
  x: number;
  y: number;
  onAccept: (suggestion: string) => void;
  onKeep: () => void;
  onClose: () => void;
}

export function SpellMenu({ word, language, x, y, onAccept, onKeep, onClose }: SpellMenuProps) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    suggestSpelling(word, language)
      .then((result) => {
        if (!cancelled) setSuggestions(result.suggestions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [word, language]);

  // Close on Escape, on a click elsewhere, or when the page moves under it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Keep the whole menu on screen, wherever it was opened.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  }, [x, y, suggestions, failed]);

  return (
    <div className="spell-menu" ref={menuRef} role="menu" aria-label={`Spelling of ${word}`}>
      <div className="spell-menu-word">
        {word} · {SPELL_LANGUAGES[language]}
      </div>
      {failed ? (
        <div className="spell-menu-note">The spell checker isn't answering</div>
      ) : suggestions === null ? (
        <div className="spell-menu-note">Looking…</div>
      ) : suggestions.length === 0 ? (
        <div className="spell-menu-note">No suggestions</div>
      ) : (
        suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            role="menuitem"
            className="spell-menu-item"
            onClick={() => onAccept(suggestion)}
          >
            Accept “{suggestion}”
          </button>
        ))
      )}
      <button type="button" role="menuitem" className="spell-menu-item spell-menu-item-keep" onClick={onKeep}>
        Keep my spelling
      </button>
    </div>
  );
}
