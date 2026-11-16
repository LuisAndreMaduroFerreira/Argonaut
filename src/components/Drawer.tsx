import { useRef, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface DrawerProps {
  side: "left" | "right";
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

// Navigation or the side panel, laid over the document on screens too narrow to fit them.
export function Drawer({ side, open, label, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, open, onClose);

  if (!open) return null;
  return (
    <div className="drawer-layer">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={ref} className={`drawer drawer-${side}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
