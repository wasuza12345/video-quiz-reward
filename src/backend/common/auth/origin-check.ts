import type { NextRequest } from "next/server";

/**
 * `Origin` header host must equal the request's own `Host` header (plan §7) — a dynamic check
 * rather than a fixed allowlist so it keeps working on every Vercel preview URL. Applied to every
 * mutating admin call, including login (a CSRF defense: cross-site forms/fetches can't set a
 * matching Origin). Browsers send `Origin` on same-origin POST/PATCH/DELETE requests too, so a
 * missing header is treated as a mismatch, not "not applicable".
 */
export function checkOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
