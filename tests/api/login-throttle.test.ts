// Exercises login-throttle.ts's threshold/window/reservation logic directly (no bcrypt) — the
// admin-auth API test proves the cheap ip+email lock (and the MAJOR device-cookie fix) end-to-end
// through the real login endpoint; the 50/hour email-only limit and its window reset are proven
// here instead, since driving 50+ attempts through bcrypt would make the suite noticeably slower
// for no extra coverage (review MINOR 6).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { emailThrottleKey, ipThrottleKey, pruneStaleThrottleRows, reserveLoginAttempt, resetLoginThrottle } from "@/backend/common/auth/login-throttle";
import { prisma } from "@/backend/lib/prisma";

function testEmail() {
  return `throttle-${randomUUID()}@test.local`;
}

async function failNTimes(email: string, ip: string, n: number) {
  for (let i = 0; i < n; i++) await reserveLoginAttempt(email, ip, { skipEmailCap: false });
}

describe("login-throttle: reserveLoginAttempt (review MINOR 1: reserve-before-check)", () => {
  afterAll(() => prisma.$disconnect());

  it("is not blocked before any failures", async () => {
    const status = await reserveLoginAttempt(testEmail(), "1.1.1.1", { skipEmailCap: false });
    expect(status.blocked).toBe(false);
  });

  it("allows 5 failures from the same (email, ip), and locks the 6th for ~15 min", async () => {
    const email = testEmail();
    const ip = "2.2.2.2";
    for (let i = 0; i < 5; i++) {
      const status = await reserveLoginAttempt(email, ip, { skipEmailCap: false });
      expect(status.blocked).toBe(false);
    }
    const sixth = await reserveLoginAttempt(email, ip, { skipEmailCap: false });
    expect(sixth.blocked).toBe(true);
    expect(sixth.retryAfterSec).toBeGreaterThan(890);
    expect(sixth.retryAfterSec).toBeLessThanOrEqual(900);
  });

  it("does not lock a different ip for the same email", async () => {
    const email = testEmail();
    await failNTimes(email, "3.3.3.3", 6);
    const status = await reserveLoginAttempt(email, "4.4.4.4", { skipEmailCap: false });
    expect(status.blocked).toBe(false);
  });

  it("an expired lock (lockedUntil in the past) no longer blocks, and the next failure starts a fresh count", async () => {
    const email = testEmail();
    const ip = "5.5.5.5";
    await failNTimes(email, ip, 6);
    expect((await reserveLoginAttempt(email, ip, { skipEmailCap: false })).blocked).toBe(true);

    // Simulate the 15 min lock having elapsed.
    await prisma.loginThrottle.update({ where: { key: ipThrottleKey(email, ip) }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    const status = await reserveLoginAttempt(email, ip, { skipEmailCap: false });
    expect(status.blocked).toBe(false);
  });

  it("review round 2 MINOR B: retries DURING an active lock don't push failCount up, so the lock's expiry buys a full fresh set of attempts", async () => {
    const email = testEmail();
    const ip = "5.5.5.6";
    await failNTimes(email, ip, 6); // trips the lock on the 6th
    expect((await reserveLoginAttempt(email, ip, { skipEmailCap: false })).blocked).toBe(true);

    // Keep retrying while still locked — none of these may raise failCount above what a single
    // post-expiry failure would need to re-trip the lock.
    await failNTimes(email, ip, 10);
    expect((await prisma.loginThrottle.findUniqueOrThrow({ where: { key: ipThrottleKey(email, ip) } })).failCount).toBe(0);

    await prisma.loginThrottle.update({ where: { key: ipThrottleKey(email, ip) }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    // A single failure right after expiry must be allowed through — not immediately re-locked by
    // the retries that happened while still locked.
    const afterExpiry = await reserveLoginAttempt(email, ip, { skipEmailCap: false });
    expect(afterExpiry.blocked).toBe(false);
  });

  it("51 failures for the same email across rotating ips trip the email-wide limit (plan §7: stops IP rotation)", async () => {
    const email = testEmail();
    for (let i = 0; i < 51; i++) {
      await reserveLoginAttempt(email, `10.0.${i}.${i}`, { skipEmailCap: false });
    }
    const status = await reserveLoginAttempt(email, "10.0.99.99", { skipEmailCap: false }); // yet another, never-before-seen ip
    expect(status.blocked).toBe(true);
    expect(status.retryAfterSec).toBeGreaterThan(0);
    expect(status.retryAfterSec).toBeLessThanOrEqual(3600);
  });

  it("skipEmailCap lets a request through past the email-wide limit while still recording the ip+email failure", async () => {
    const email = testEmail();
    for (let i = 0; i < 51; i++) {
      await reserveLoginAttempt(email, `20.0.${i}.${i}`, { skipEmailCap: false });
    }
    const skipped = await reserveLoginAttempt(email, "20.0.200.1", { skipEmailCap: true });
    expect(skipped.blocked).toBe(false);
  });

  it("the email-wide window resets after an hour — a stale count does not keep blocking forever", async () => {
    const email = testEmail();
    const key = emailThrottleKey(email);
    await prisma.loginThrottle.create({ data: { key, failCount: 50, windowStart: new Date(Date.now() - 61 * 60 * 1000) } });

    // A failure now lands after the 1h window has lapsed — it must restart the window (failCount
    // → 1), not push the stale 50 over the limit.
    const status = await reserveLoginAttempt(email, "30.0.0.1", { skipEmailCap: false });
    expect(status.blocked).toBe(false);

    const row = await prisma.loginThrottle.findUniqueOrThrow({ where: { key } });
    expect(row.failCount).toBe(1);
    expect(row.windowStart.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("resetLoginThrottle clears both the ip+email lock and the email-wide count", async () => {
    const email = testEmail();
    const ip = "6.6.6.6";
    await failNTimes(email, ip, 6);
    expect((await reserveLoginAttempt(email, ip, { skipEmailCap: false })).blocked).toBe(true);

    await resetLoginThrottle(email, ip);
    expect((await reserveLoginAttempt(email, ip, { skipEmailCap: false })).blocked).toBe(false);
  });

  it("pruneStaleThrottleRows deletes rows untouched for over 24h", async () => {
    const email = testEmail();
    const key = ipThrottleKey(email, "40.0.0.1");
    await prisma.loginThrottle.create({ data: { key, failCount: 1, windowStart: new Date() } });
    await prisma.loginThrottle.update({ where: { key }, data: { updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    await pruneStaleThrottleRows();
    expect(await prisma.loginThrottle.findUnique({ where: { key } })).toBeNull();
  });
});
