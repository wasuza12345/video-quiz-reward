import type { ReactNode } from "react";

export interface CardProps {
  padding?: number | string;
  interactive?: boolean;
  as?: "div" | "a";
  href?: string;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
  [key: string]: unknown;
}

export function Card({ padding = 16, interactive = false, as = "div", className, style, children, ...rest }: CardProps) {
  const Tag = as as "div";
  return (
    <Tag
      className={[interactive ? "card-interactive" : "", className].filter(Boolean).join(" ")}
      style={{
        display: "block",
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding,
        textDecoration: "none",
        color: "inherit",
        transition: `transform var(--motion-duration) var(--motion-ease), box-shadow var(--motion-duration) var(--motion-ease)`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
