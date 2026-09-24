"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastRequestLike {
  id: number;
  key: string;
  message: string;
}

export interface VisibleToast {
  id: number;
  message: string;
  sticky: boolean;
}

/** Max one visible, auto-hide 3s (sticky for the "offline" key until dismissed), rate-limited to 1/5s per key. */
export function useToast(request: ToastRequestLike | null) {
  const [visible, setVisible] = useState<VisibleToast | null>(null);
  const lastShownAt = useRef<Map<string, number>>(new Map());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHandledId = useRef<number | null>(null);

  useEffect(() => {
    if (!request || request.id === lastHandledId.current) return;
    lastHandledId.current = request.id;

    const now = Date.now();
    const last = lastShownAt.current.get(request.key) ?? 0;
    if (now - last < 5000) return;
    lastShownAt.current.set(request.key, now);

    const sticky = request.key === "offline";
    setVisible({ id: request.id, message: request.message, sticky });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!sticky) hideTimer.current = setTimeout(() => setVisible(null), 3000);
  }, [request]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const dismissSticky = useCallback(() => setVisible((v) => (v?.sticky ? null : v)), []);

  return { visible, dismissSticky };
}
