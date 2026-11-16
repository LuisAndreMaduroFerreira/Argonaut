import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-text">{children}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
