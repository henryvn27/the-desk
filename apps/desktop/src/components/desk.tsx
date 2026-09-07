import type { ReactNode } from "react";
import { cx, StatusDot } from "./base";

export function WorkspaceHeader({
  eyebrow,
  title,
  detail,
  status,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  status?: { tone: "neutral" | "positive" | "warning" | "danger"; label: string };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("ds-workspace-header", className)}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
        {status && (
          <div className="ds-workspace-status" role="status">
            <StatusDot tone={status.tone} />
            {status.label}
          </div>
        )}
      </div>
      {actions && <div className="ds-workspace-actions">{actions}</div>}
    </header>
  );
}

export function EntityMeta({ children }: { children: ReactNode }) {
  return <div className="ds-entity-meta">{children}</div>;
}
