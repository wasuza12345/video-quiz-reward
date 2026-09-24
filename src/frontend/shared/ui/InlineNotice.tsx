import type { ReactNode } from "react";
import { Button } from "./Button";

export type InlineNoticeTone = "info" | "warning" | "danger" | "success";

const TONE_BG: Record<InlineNoticeTone, string> = {
  info: "var(--info-bg)",
  warning: "var(--warning-bg)",
  danger: "var(--danger-bg)",
  success: "var(--success-bg)",
};
const TONE_TEXT: Record<InlineNoticeTone, string> = {
  info: "var(--brand-primary)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  success: "var(--success)",
};

export interface InlineNoticeProps {
  tone?: InlineNoticeTone;
  icon?: ReactNode;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  role?: "status" | "alert";
}

export function InlineNotice({ tone = "info", icon, children, action, role = "status" }: InlineNoticeProps) {
  return (
    <div
      role={role}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 12,
        background: TONE_BG[tone],
        color: TONE_TEXT[tone],
        fontSize: "var(--fs-sm)",
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{children}</span>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
