import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "../constants/app";
import { header as copy } from "../constants/copy.th";

export interface PublicHeaderProps {
  /** Shows the mobile-only back-to-list icon link (spec §2.1: "/watch/* on ≤ 600"). */
  showBack?: boolean;
  pointsBadge: ReactNode;
}

export function PublicHeader({ showBack = false, pointsBadge }: PublicHeaderProps) {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--brand-primary)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 56,
          maxWidth: "var(--max-width-public)",
          margin: "0 auto",
          padding: "0 var(--gutter)",
        }}
      >
        {showBack && (
          <Link
            href="/"
            aria-label={copy.backAriaLabel}
            className="on-navy header-back-link"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              marginLeft: -8,
              color: "#fff",
              textDecoration: "none",
            }}
          >
            <BackIcon />
          </Link>
        )}
        <Link
          href="/"
          aria-label={copy.homeAriaLabel}
          className="on-navy"
          style={{ display: "flex", alignItems: "center", minHeight: 44, color: "#fff", fontWeight: 700, fontSize: 18, textDecoration: "none" }}
        >
          {APP_NAME}
        </Link>
        <div style={{ flex: 1 }} />
        {pointsBadge}
      </div>
    </header>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
