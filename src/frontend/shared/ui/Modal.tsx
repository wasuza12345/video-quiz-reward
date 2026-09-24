"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  mode?: "dialog" | "sheet";
  /** false disables Esc and backdrop-click dismissal (the quiz can't be dismissed — spec §4.3.5). */
  dismissible?: boolean;
  onClose?: () => void;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}

/**
 * Native `<dialog>` in modal mode: the browser handles the focus trap, returning focus to the
 * trigger on close, and putting the rest of the page in the top layer (equivalent to `inert`).
 * `mode: "sheet"` is the ≤600px bottom-sheet presentation of the same dialog.
 */
export function Modal({ open, mode = "dialog", dismissible = true, onClose, labelledBy, describedBy, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      if (!dismissible) e.preventDefault();
      else onClose?.();
    };
    const onClick = (e: MouseEvent) => {
      if (dismissible && e.target === dialog) onClose?.();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
    };
  }, [dismissible, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={mode === "sheet" ? "modal-sheet" : "modal-dialog"}
      onClose={() => {
        // Chrome's CloseWatcher can force a <dialog> closed on a second rapid Esc even though we
        // preventDefault()'d the `cancel` event for a non-dismissible one (MAJOR 2) — reopen it
        // immediately rather than leaving `open` state and the actual DOM out of sync.
        if (!dismissible && open) {
          ref.current?.showModal();
          return;
        }
        onClose?.();
      }}
    >
      {open && children}
    </dialog>
  );
}
