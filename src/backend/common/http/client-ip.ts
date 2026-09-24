import type { NextRequest } from "next/server";

/**
 * The requester's IP as Vercel reports it. `x-real-ip` is Vercel's own header, set to the actual
 * client and not attacker-controlled; the leftmost `X-Forwarded-For` entry is client-suppliable
 * and must never be trusted for a security control like login-throttle (plan §7).
 */
export function getClientIp(request: NextRequest): string {
  return request.headers.get("x-real-ip") ?? "unknown";
}
