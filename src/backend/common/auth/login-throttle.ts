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

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
function ipKey(email: string, ip: string): string {
  return `ip:${sha(`${email}|${ip}`)}`;
}
function emailKey(email: string): string {
  return `email:${sha(email)}`;
}

export interface ThrottleStatus {
  blocked: boolean;
  retryAfterSec?: number;
}

/** Call before verifying the password — a blocked attempt never touches bcrypt. */
export async function checkLoginThrottle(email: string, ip: string): Promise<ThrottleStatus> {
  const now = new Date();
  const [ipRow, emailRow] = await Promise.all([
    prisma.loginThrottle.findUnique({ where: { key: ipKey(email, ip) } }),
    prisma.loginThrottle.findUnique({ where: { key: emailKey(email) } }),
  ]);

  if (ipRow?.lockedUntil && ipRow.lockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((ipRow.lockedUntil.getTime() - now.getTime()) / 1000) };
  }
  if (emailRow && emailRow.failCount >= EMAIL_FAIL_LIMIT && now.getTime() - emailRow.windowStart.getTime() < EMAIL_WINDOW_MS) {
    const retryAfterMs = emailRow.windowStart.getTime() + EMAIL_WINDOW_MS - now.getTime();
    return { blocked: true, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }
  return { blocked: false };
}

/**
 * Atomic per-key increment (SQL `failCount = failCount + 1`), then a follow-up write only when a
 * key's own threshold/window just tripped — two awaited calls per key rather than one interactive
 * transaction (plan §9: services avoid those; a plain sequence is enough here since each key's
 * rows are independent and the worst case of a lost race is one extra allowed attempt).
 */
export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const now = new Date();

  const ipRow = await prisma.loginThrottle.upsert({
    where: { key: ipKey(email, ip) },
    create: { key: ipKey(email, ip), failCount: 1, windowStart: now },
    update: { failCount: { increment: 1 } },
  });
  if (ipRow.failCount >= IP_FAIL_LIMIT) {
    // Reset alongside the lock so the 15 min wait always buys a fresh set of attempts afterward,
    // instead of re-locking on the very next failure.
    await prisma.loginThrottle.update({
      where: { key: ipKey(email, ip) },
      data: { failCount: 0, lockedUntil: new Date(now.getTime() + IP_LOCKOUT_MS) },
    });
  }

  const emailRow = await prisma.loginThrottle.upsert({
    where: { key: emailKey(email) },
    create: { key: emailKey(email), failCount: 1, windowStart: now },
    update: { failCount: { increment: 1 } },
  });
  if (now.getTime() - emailRow.windowStart.getTime() >= EMAIL_WINDOW_MS) {
    // The hour-long window lapsed — this failure starts a new one rather than piling onto a stale count.
    await prisma.loginThrottle.update({
      where: { key: emailKey(email) },
      data: { failCount: 1, windowStart: now },
    });
  }
}

/** Clears both counters on a successful login. */
export async function resetLoginThrottle(email: string, ip: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: { in: [ipKey(email, ip), emailKey(email)] } } });
}
