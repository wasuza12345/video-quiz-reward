import type { ReactNode } from "react";
import { Button } from "./Button";

export interface ErrorStateProps {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export function ErrorState({ icon, title, body, action, secondaryAction }: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 8,
        padding: 32,
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <span style={{ color: "var(--danger)", fontSize: 48 }} aria-hidden="true">
        {icon ?? "!"}
      </span>
      <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700 }}>{title}</h2>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", margin: 0 }}>{body}</p>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {action && (
          <Button variant="primary-red" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        {secondaryAction && (
          <Button variant="ghost" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body: string;
}

export function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8, padding: 32 }}>
      <span
        aria-hidden="true"
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
        }}
      >
        {icon ?? "▶"}
      </span>
      <h2 style={{ fontSize: "var(--fs-lg)", fontWeight: 700 }}>{title}</h2>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", margin: 0 }}>{body}</p>
    </div>
  );
}
