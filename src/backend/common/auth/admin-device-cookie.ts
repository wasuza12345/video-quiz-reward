// "Known device" cookie (review MAJOR on P5a): recognizes a browser that has logged in
// successfully as a given admin before, so the email-wide login-throttle cap (login-throttle.ts)
// can be skipped for it. Without this, anyone who learns the admin's email can lock the real
// admin out by failing 50 logins/hour from rotating IPs — the device cookie is what lets the real
// admin's browser keep working through that while a stranger's browser still can't.
//
// HMAC-signed like user-cookie.ts, not a JWT: it carries no claims that need to expire on their
// own schedule (Max-Age does that), just an identity binding that must not be forgeable.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/backend/config/env";

export const ADMIN_DEVICE_COOKIE_NAME = "vq_admin_dev";
export const ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** `<adminId>.<nonce>.<hmac>` — issued fresh on every successful login (refreshes the 90 days). */
export function issueAdminDeviceCookieValue(adminId: string): string {
  const payload = `${adminId}.${randomUUID()}`;
  return `${payload}.${sign(payload, getEnv().ADMIN_SESSION_SECRET)}`;
}

/** True only if `value` is a validly signed device cookie issued for exactly `expectedAdminId` —
 * a device recognized for one admin never vouches for another. */
export function verifyAdminDeviceCookieValue(value: string | undefined | null, expectedAdminId: string): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [adminId, nonce, signature] = parts;
  if (adminId !== expectedAdminId) return false;

  const expected = sign(`${adminId}.${nonce}`, getEnv().ADMIN_SESSION_SECRET);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
