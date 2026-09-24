import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/backend/config/env";

/** Signed anonymous identity cookie (plan §4.1, D2): httpOnly, Secure, SameSite=Lax, 1 year. */
export const USER_COOKIE_NAME = "vq_uid";
export const USER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function sign(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("base64url");
}

/** `<uuid>.<hmac>` — the signature is over the id only, so it never needs its own expiry. */
export function issueUserCookieValue(userId: string = randomUUID()): { userId: string; value: string } {
  const { USER_COOKIE_SECRET } = getEnv();
  return { userId, value: `${userId}.${sign(userId, USER_COOKIE_SECRET)}` };
}

/** Verifies a cookie value and returns the user id, or null if missing/forged/malformed. */
export function verifyUserCookieValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const userId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = sign(userId, getEnv().USER_COOKIE_SECRET);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

/**
 * The user id for the current request. `proxy.ts` guarantees a valid `vq_uid` on every request
 * this is called from, so a missing/invalid cookie here means the proxy didn't run (misconfigured
 * deployment or a route outside its matcher) — that is a server error, not a client one.
 */
export function requireUserId(request: NextRequest): string {
  const userId = verifyUserCookieValue(request.cookies.get(USER_COOKIE_NAME)?.value);
  if (!userId) throw new Error(`missing or invalid ${USER_COOKIE_NAME} cookie — is proxy.ts running for this route?`);
  return userId;
}
