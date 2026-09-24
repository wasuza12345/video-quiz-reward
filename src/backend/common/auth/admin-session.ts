// Admin session cookie (plan §7, D4): a `jose` HS256 JWT carrying { adminId, tokenVersion }.
// `jose` (not `jsonwebtoken`) so this stays runtime-agnostic (WebCrypto) — proxy.ts's fast path
// verifies the signature here with no DB read; requireAdmin() below adds the DB tokenVersion
// check and is the only check either layer is allowed to rely on alone (plan §7 layer table).
import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "@/backend/config/env";

export const ADMIN_COOKIE_NAME = "vq_admin";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h

export interface AdminSessionPayload {
  adminId: string;
  tokenVersion: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().ADMIN_SESSION_SECRET);
}

export async function issueAdminCookieValue(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT({ adminId: payload.adminId, tokenVersion: payload.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** Signature + expiry only, no DB — see the module note above for why that's deliberate. */
export async function verifyAdminCookieValue(value: string | undefined | null): Promise<AdminSessionPayload | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.adminId !== "string" || typeof payload.tokenVersion !== "number") return null;
    return { adminId: payload.adminId, tokenVersion: payload.tokenVersion };
  } catch {
    return null;
  }
}

/** `proxy.ts`'s early-reject check (plan §7) — true iff the cookie carries a validly signed,
 * unexpired session. Wired here rather than duplicated so proxy and the rest of the app agree on
 * exactly what "a session cookie" means. */
export async function verifyAdminCookie(value: string | undefined | null): Promise<boolean> {
  return (await verifyAdminCookieValue(value)) !== null;
}
