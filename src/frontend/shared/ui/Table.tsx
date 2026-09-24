"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "./ErrorState";

export type TableRowTone = "warning" | "danger" | "muted";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-align numeric/short columns. */
  align?: "left" | "right" | "center";
  /** Overrides `rowHref` for this cell specifically (e.g. a "user" column linking to the user's
   * own page inside an otherwise session-linked row) — never nests an `<a>`/button inside another
   * link. Returning undefined renders the cell as plain (non-link) content. Desktop table only. */
  href?: (row: T) => string | undefined;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | undefined;
  rowTone?: (row: T) => TableRowTone | undefined;
  emptyTitle?: string;
  emptyBody?: string;
  /** Renders inside each ≤600px card, above the column values (e.g. a thumbnail + title row). */
  mobileCardHeader?: (row: T) => ReactNode;
  /** Column keys to skip in the ≤600px card body (already shown via mobileCardHeader, or not useful stacked). */
  mobileHiddenKeys?: string[];
}

const TONE_STYLE: Record<TableRowTone, React.CSSProperties> = {
  warning: { background: "var(--warning-bg)", borderLeft: "4px solid var(--warning)" },
  danger: { background: "var(--danger-bg)", borderLeft: "4px solid var(--danger)" },
  muted: { color: "var(--text-2)" },
};

/** Admin data table: a real `<table>` ≥601px, stacked cards ≤600px (spec §5: "tables turn into
 * stacked cards ≤ 600"). Row can optionally be a link (the whole row, spec's "row is a link"). */
export function Table<T>({ columns, rows, rowKey, rowHref, rowTone, emptyTitle, emptyBody, mobileCardHeader, mobileHiddenKeys }: TableProps<T>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle ?? "ไม่มีข้อมูล"} body={emptyBody ?? ""} />;
  }

  const visibleMobileColumns = columns.filter((c) => !mobileHiddenKeys?.includes(c.key));

  return (
    <>
      <table className="admin-table-desktop" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.align ?? "left", padding: "12px 16px", fontSize: "var(--fs-xs)", color: "var(--text-2)", fontWeight: 600, borderBottom: "1px solid var(--border-control)" }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowLinkHref = rowHref?.(row);
            const tone = rowTone?.(row);
            const rowStyle: React.CSSProperties = { borderBottom: "1px solid var(--surface-2)", ...(tone ? TONE_STYLE[tone] : {}), ...(rowLinkHref ? { cursor: "pointer" } : {}) };
            return (
              <tr key={rowKey(row)} style={rowStyle}>
                {columns.map((c) => {
                  const cellHref = c.href ? c.href(row) : rowLinkHref;
                  return (
                    <td key={c.key} style={{ padding: 0, textAlign: c.align ?? "left", verticalAlign: "middle" }}>
                      {cellHref ? (
                        <Link href={cellHref} style={{ display: "block", padding: "12px 16px", color: "inherit", textDecoration: "none" }}>
                          {c.render(row)}
                        </Link>
                      ) : (
                        <div style={{ padding: "12px 16px" }}>{c.render(row)}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="admin-table-mobile" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((row) => {
          const href = rowHref?.(row);
          const tone = rowTone?.(row);
          const cardStyle: React.CSSProperties = {
            display: "block",
            background: "var(--surface)",
            borderRadius: "var(--radius-card)",
            padding: 16,
            boxShadow: "var(--shadow-card)",
            color: "inherit",
            textDecoration: "none",
            ...(tone ? TONE_STYLE[tone] : {}),
          };
          const content = (
            <>
              {mobileCardHeader?.(row)}
              <dl style={{ margin: mobileCardHeader ? "8px 0 0" : 0, display: "grid", gap: 4 }}>
                {visibleMobileColumns.map((c) => (
                  <div key={c.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "var(--fs-sm)" }}>
                    <dt style={{ color: "var(--text-2)" }}>{c.header}</dt>
                    <dd style={{ margin: 0, textAlign: "right" }}>{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </>
          );
          return href ? (
            <Link key={rowKey(row)} href={href} style={cardStyle}>
              {content}
            </Link>
          ) : (
            <div key={rowKey(row)} style={cardStyle}>
              {content}
            </div>
          );
        })}
      </div>
    </>
  );
}
