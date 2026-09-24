"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";

export interface StatTile {
  key: string;
  label: string;
  sub?: string;
  value: number;
  icon?: ReactNode;
  /** Flagged tile: warning styling + a link when value > 0 (spec §5.2). */
  warningWhenPositive?: boolean;
  href?: string;
  ariaLabel?: string;
}

function TileBody({ tile }: { tile: StatTile }) {
  const flagged = tile.warningWhenPositive && tile.value > 0;
  return (
    <div
      style={{
        background: flagged ? "var(--warning-bg)" : "var(--surface)",
        borderLeft: flagged ? "4px solid var(--warning)" : "none",
        borderRadius: "var(--radius-card)",
        padding: "16px 20px",
        minHeight: 96,
        position: "relative",
        display: "block",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      {tile.icon && <div style={{ position: "absolute", top: 16, right: 20, fontSize: 24 }}>{tile.icon}</div>}
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", margin: "0 0 4px" }}>{tile.label}</p>
      <p style={{ fontSize: 32, fontWeight: 700, color: "var(--brand-primary-dark)", margin: 0 }}>{tile.value.toLocaleString("th-TH")}</p>
      {tile.sub && <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)", margin: "4px 0 0" }}>{tile.sub}</p>}
    </div>
  );
}

export function StatTiles({ tiles, loading }: { tiles: StatTile[]; loading?: boolean }) {
  return (
    <div className="stat-tiles-grid" style={{ display: "grid", gap: 16 }}>
      {loading
        ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={96} radius="var(--radius-card)" />)
        : tiles.map((tile) =>
            tile.href ? (
              <Link key={tile.key} href={tile.href} aria-label={tile.ariaLabel} style={{ display: "block" }}>
                <TileBody tile={tile} />
              </Link>
            ) : (
              <div key={tile.key}>
                <TileBody tile={tile} />
              </div>
            ),
          )}
    </div>
  );
}
