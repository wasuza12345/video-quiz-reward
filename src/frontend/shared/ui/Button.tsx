"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary-red" | "primary-navy" | "outline" | "outline-white" | "white" | "ghost" | "danger-text";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANT_STYLE: Record<ButtonVariant, React.CSSProperties> = {
  "primary-red": { background: "var(--brand-accent)", color: "#fff", boxShadow: "var(--shadow-cta)", border: "none" },
  "primary-navy": { background: "var(--brand-primary)", color: "#fff", border: "none" },
  outline: { background: "var(--surface)", color: "var(--brand-primary-dark)", border: "1px solid var(--border-control)" },
  "outline-white": { background: "transparent", color: "#fff", border: "1px solid #ffffff" },
  white: { background: "#fff", color: "var(--brand-primary-dark)", border: "none" },
  ghost: { background: "transparent", color: "var(--brand-primary-dark)", border: "none" },
  "danger-text": { background: "transparent", color: "var(--danger)", border: "none" },
};

export function Button({ variant = "outline", size = "md", loading = false, icon, disabled, className, children, style, ...rest }: ButtonProps) {
  const height = size === "md" ? 48 : 44;
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      className={className}
      aria-disabled={isDisabled || undefined}
      disabled={isDisabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height,
        padding: "0 24px",
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font)",
        fontWeight: 700,
        fontSize: "var(--fs-md)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled && !loading ? 0.4 : 1,
        transition: `transform var(--motion-duration) var(--motion-ease), opacity var(--motion-duration) var(--motion-ease)`,
        ...VARIANT_STYLE[variant],
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: "spin 0.8s linear infinite" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <style>{`@media (prefers-reduced-motion: no-preference) { @keyframes spin { to { transform: rotate(360deg); } } }`}</style>
    </svg>
  );
}
