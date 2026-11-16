import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

interface MenuProps {
  label: string;
  // Where a right-click opened it; without it, the menu hangs under the row it belongs to.
  at: { x: number; y: number } | null;
  // Changes when the items do (a submenu), so focus goes back to the first item.
  focusKey?: unknown;
  onEscape: () => void;
  // A click outside the menu, or Tab out of it.
  onDismiss: () => void;
  children: ReactNode;
}

// A small menu of role="menuitem" buttons: focus starts on the first, arrow keys and Home/End
// move between them, Escape leaves, and a menu opened at the pointer is kept on screen.
export function Menu({ label, at, focusKey, onEscape, onDismiss, children }: MenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties | undefined>(
    at ? { position: "fixed", left: at.x, top: at.y, right: "auto" } : undefined,
  );

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [focusKey]);

  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPosition({
      position: "fixed",
      right: "auto",
      left: Math.max(8, Math.min(at.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - rect.height - 8)),
    });
  }, [at, focusKey]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onDismiss]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
    } else if (event.key === "Tab") {
      onDismiss();
    }
  };

  return (
    <div ref={ref} className="row-menu" style={position} role="menu" aria-label={label} onKeyDown={onKeyDown} data-own-escape>
      {children}
    </div>
  );
}
