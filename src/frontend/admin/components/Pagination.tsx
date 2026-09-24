"use client";

import { IconButton } from "@/frontend/shared/ui/IconButton";
import { pagination as copy } from "../constants/copy.th";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** spec §5.8 — hidden when everything fits on one page. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  if (total <= pageSize) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 }}>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{copy.showing(from, to, total)}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <IconButton
          aria-label={copy.prev}
          aria-disabled={page <= 1}
          icon={<span aria-hidden="true">←</span>}
          onClick={() => page > 1 && onPageChange(page - 1)}
        />
        <span style={{ fontSize: "var(--fs-sm)" }}>{copy.pageOf(page, pages)}</span>
        <IconButton
          aria-label={copy.next}
          aria-disabled={page >= pages}
          icon={<span aria-hidden="true">→</span>}
          onClick={() => page < pages && onPageChange(page + 1)}
        />
      </div>
    </div>
  );
}
