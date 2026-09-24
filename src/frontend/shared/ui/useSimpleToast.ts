"use client";

import { useCallback, useRef, useState } from "react";
import { useToast, type ToastRequestLike } from "./useToast";

/** A page-local toast trigger built on top of useToast/Toast (shared/ui) — for one-off admin save
 * confirmations, not the rate-limited/sticky watch-page flow useToast alone models directly. */
export function useSimpleToast() {
  const counter = useRef(0);
  const [request, setRequest] = useState<ToastRequestLike | null>(null);
  const { visible } = useToast(request);

  const show = useCallback((message: string, key = "default") => {
    counter.current += 1;
    setRequest({ id: counter.current, key, message });
  }, []);

  return { show, visible };
}
