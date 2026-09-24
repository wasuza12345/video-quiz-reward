export interface ContextBannerProps {
  tone: "info";
  children: string;
}

/** Above the player, only when relevant (spec §4.3.7). */
export function ContextBanner({ children }: ContextBannerProps) {
  return (
    <div role="status" style={{ padding: "12px 16px", borderRadius: 16, background: "var(--info-bg)", color: "var(--brand-primary)", fontSize: "var(--fs-sm)" }}>
      {children}
    </div>
  );
}
