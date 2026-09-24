"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  icon: ReactNode;
  tone?: "on-light" | "on-navy";
}

/** 44×44 minimum hit area (spec §7 Accessibility). */
export function IconButton({ icon, tone = "on-light", className, style, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={[tone === "on-navy" ? "on-navy" : "", className].filter(Boolean).join(" ")}
      style={{
        width: 44,
        height: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "none",
        background: "transparent",
        color: tone === "on-navy" ? "#fff" : "var(--text)",
        cursor: "pointer",
        ...style,
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}
