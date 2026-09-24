// Admin login throttle (plan §7): two independent `LoginThrottle` rows per attempt — one keyed
// on (email, ip) for a short hard lockout, one keyed on email alone so rotating IPs can't bypass
// it. Keys are hashed (not stored as plaintext email/ip) since this table is otherwise readable
// audit-adjacent data.
import { createHash } from "node:crypto";
import { prisma } from "@/backend/lib/prisma";

const IP_FAIL_LIMIT = 5;
const IP_LOCKOUT_MS = 15 * 60 * 1000;
const EMAIL_FAIL_LIMIT = 50;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;
const STALE_ROW_MS = 24 * 60 * 60 * 1000;

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
export function ipThrottleKey(email: string, ip: string): string {
  return `ip:${sha(`${email}|${ip}`)}`;
}
export function emailThrottleKey(email: string): string {
  return `email:${sha(email)}`;
}

export interface ThrottleStatus {
  blocked: boolean;
  retryAfterSec?: number;
}

/** Best-effort hygiene, not a correctness requirement — run opportunistically, never awaited by a
 * caller that needs its result (review MINOR 3). Every window here is well under 24h, so a row
 * this old is always stale garbage, not a live counter. */
export async function pruneStaleThrottleRows(): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - STALE_ROW_MS) } } });
}

/**
 * Reserves this attempt against both counters BEFORE the caller checks the password (review
 * MINOR 1) — the old design checked-then-recorded as two separate steps, which let concurrent
 * requests all pass the check before any of them recorded a failure. Each key's own increment is
 * a single atomic SQL `failCount = failCount + 1`; a follow-up write only happens when that key's
 * own threshold/window just tripped, which is safe to lose a race on (worst case: one extra
 * allowed attempt, not an unbounded bypass).
 *
 * `skipEmailCap`: a request carrying a valid `vq_admin_dev` "known device" cookie for the admin
 * being logged into skips the email-wide 50/hour cap (review MAJOR) — otherwise anyone who learns
 * the admin's email can lock the real admin out by failing 50 times from other IPs. The
 * per-(email, ip) lock still applies regardless, so this never disables throttling entirely.
 */
export async function reserveLoginAttempt(email: string, ip: string, opts: { skipEmailCap: boolean }): Promise<ThrottleStatus> {
  await pruneStaleThrottleRows();
  const now = new Date();

  const ipKey = ipThrottleKey(email, ip);
  const ipRow = await prisma.loginThrottle.upsert({
    where: { key: ipKey },
    create: { key: ipKey, failCount: 1, windowStart: now },
    update: { failCount: { increment: 1 } },
  });
  if (ipRow.lockedUntil && ipRow.lockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((ipRow.lockedUntil.getTime() - now.getTime()) / 1000) };
  }
  if (ipRow.failCount > IP_FAIL_LIMIT) {
    // Reset alongside the lock so the 15 min wait always buys a fresh set of attempts afterward,
    // instead of re-locking on the very next failure.
    await prisma.loginThrottle.update({ where: { key: ipKey }, data: { failCount: 0, lockedUntil: new Date(now.getTime() + IP_LOCKOUT_MS) } });
    return { blocked: true, retryAfterSec: Math.ceil(IP_LOCKOUT_MS / 1000) };
  }

  if (opts.skipEmailCap) return { blocked: false };

  const emailKey = emailThrottleKey(email);
  let emailRow = await prisma.loginThrottle.upsert({
    where: { key: emailKey },
    create: { key: emailKey, failCount: 1, windowStart: now },
    update: { failCount: { increment: 1 } },
  });
  if (now.getTime() - emailRow.windowStart.getTime() >= EMAIL_WINDOW_MS) {
    // The hour-long window lapsed — this attempt starts a new one rather than piling onto a stale count.
    emailRow = await prisma.loginThrottle.update({ where: { key: emailKey }, data: { failCount: 1, windowStart: now } });
  }
  if (emailRow.failCount > EMAIL_FAIL_LIMIT) {
    const retryAfterMs = emailRow.windowStart.getTime() + EMAIL_WINDOW_MS - now.getTime();
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  return { blocked: false };
}

/** Clears both counters on a successful login — the reservation from `reserveLoginAttempt` for
 * this same request counted as a hit, so a genuine success un-counts it immediately. */
export async function resetLoginThrottle(email: string, ip: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: { in: [ipThrottleKey(email, ip), emailThrottleKey(email)] } } });
}
