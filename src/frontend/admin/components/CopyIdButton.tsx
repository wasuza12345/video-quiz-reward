"use client";

import { IconButton } from "@/frontend/shared/ui/IconButton";
import { useSimpleToast } from "@/frontend/shared/ui/useSimpleToast";
import { Toast } from "@/frontend/shared/ui/Toast";
import { users as copy } from "../constants/copy.th";

/** 44×44 copy-full-id button (spec §5.5). Renders its own toast so callers don't need to wire one up. */
export function CopyIdButton({ id }: { id: string }) {
  const { show, visible } = useSimpleToast();
  return (
    <>
      <IconButton
        aria-label={copy.copyAriaLabel}
        icon={<span aria-hidden="true">⧉</span>}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.writeText(id).then(() => show(copy.copiedToast)).catch(() => {});
        }}
      />
      {visible && <Toast message={visible.message} />}
    </>
  );
}
