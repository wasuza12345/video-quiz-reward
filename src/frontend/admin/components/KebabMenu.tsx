"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/frontend/shared/ui/IconButton";

export interface KebabMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}

export function KebabMenu({ items, ariaLabel }: { items: KebabMenuItem[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <IconButton
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        }
      />
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: 44,
            minWidth: 200,
            background: "var(--surface)",
            borderRadius: 12,
            boxShadow: "var(--shadow-modal)",
            padding: 4,
            zIndex: 20,
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                minHeight: 44,
                border: "none",
                background: "transparent",
                color: item.tone === "danger" ? "var(--danger)" : "var(--text)",
                fontSize: "var(--fs-sm)",
                fontFamily: "var(--font)",
                cursor: "pointer",
                borderRadius: 8,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
