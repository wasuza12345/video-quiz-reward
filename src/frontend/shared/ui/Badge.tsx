import type { ReactNode } from "react";

export type BadgeTone = "navy" | "success" | "warning" | "danger" | "info" | "neutral";

const TONE_STYLE: Record<BadgeTone, React.CSSProperties> = {
  navy: { background: "var(--brand-primary)", color: "#fff" },
  success: { background: "var(--success-bg)", color: "var(--success)" },
  warning: { background: "var(--warning-bg)", color: "var(--warning)" },
  danger: { background: "var(--danger-bg)", color: "var(--danger)" },
  info: { background: "var(--info-bg)", color: "var(--brand-primary)" },
  neutral: { background: "var(--surface-2)", color: "var(--text-2)" },
};

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Tag/badge — colour is never the only signal; the text always says what's true (spec §7). */
export function Badge({ tone = "neutral", icon, children, className }: BadgeProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 24,
        padding: "0 8px",
        borderRadius: "var(--radius-tag)",
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...TONE_STYLE[tone],
      }}
    >
      {icon}
      {children}
    </span>
  );
}
