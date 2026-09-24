"use client";

import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** "danger" for a destructive action (archive/delete — spec §5.3/§5.4). */
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

/** Dismissible modal (Esc/backdrop cancel, spec §6) wrapping the standard confirm/cancel pattern
 * used by archive and delete actions across the admin panel. */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, tone = "default", onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-dialog-title" describedBy="confirm-dialog-body">
      <div style={{ padding: 24, maxWidth: 400 }}>
        <h2 id="confirm-dialog-title" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, margin: "0 0 8px" }}>
          {title}
        </h2>
        <p id="confirm-dialog-body" style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", margin: "0 0 20px" }}>
          {body}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "primary-red" : "primary-navy"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
