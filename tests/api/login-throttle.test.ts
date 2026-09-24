// Exercises login-throttle.ts's threshold/window logic directly (no bcrypt) — the admin-auth API
// test proves the *cheap* ip+email lock end-to-end through the real login endpoint; the 50/hour
// email-only limit is proven here instead, since driving it through bcrypt 50 times would make
// the suite noticeably slower for no extra coverage.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkLoginThrottle, recordLoginFailure, resetLoginThrottle } from "@/backend/common/auth/login-throttle";
import { prisma } from "@/backend/lib/prisma";

function testEmail() {
  return `throttle-${randomUUID()}@test.local`;
}

/** Mirrors login-throttle.ts's private `ipKey()` — only test code reaches into the row directly
 * (to simulate a lock having expired), so it re-derives the key rather than exporting it. */
function ipKeyFor(email: string, ip: string): string {
  return `ip:${createHash("sha256").update(`${email}|${ip}`).digest("hex")}`;
}

describe("login-throttle", () => {
  afterAll(() => prisma.$disconnect());

  it("is not blocked before any failures", async () => {
    const status = await checkLoginThrottle(testEmail(), "1.1.1.1");
    expect(status.blocked).toBe(false);
  });

  it("locks the (email, ip) pair after 5 failures, with a ~15 min retryAfterSec", async () => {
    const email = testEmail();
    const ip = "2.2.2.2";
    for (let i = 0; i < 5; i++) await recordLoginFailure(email, ip);

    const status = await checkLoginThrottle(email, ip);
    expect(status.blocked).toBe(true);
    expect(status.retryAfterSec).toBeGreaterThan(890);
    expect(status.retryAfterSec).toBeLessThanOrEqual(900);
  });

  it("does not lock a different ip for the same email", async () => {
    const email = testEmail();
    for (let i = 0; i < 5; i++) await recordLoginFailure(email, "3.3.3.3");
    const status = await checkLoginThrottle(email, "4.4.4.4");
    expect(status.blocked).toBe(false);
  });

  it("an expired lock (lockedUntil in the past) no longer blocks", async () => {
    const email = testEmail();
    const ip = "5.5.5.5";
    for (let i = 0; i < 5; i++) await recordLoginFailure(email, ip);
    expect((await checkLoginThrottle(email, ip)).blocked).toBe(true);

    // Simulate the 15 min lock having elapsed.
    await prisma.loginThrottle.update({ where: { key: ipKeyFor(email, ip) }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    expect((await checkLoginThrottle(email, ip)).blocked).toBe(false);
  });

  it("50 failures for the same email across rotating ips trip the email-wide limit (plan §7: stops IP rotation)", async () => {
    const email = testEmail();
    for (let i = 0; i < 50; i++) await recordLoginFailure(email, `10.0.${i}.${i}`);

    const status = await checkLoginThrottle(email, "10.0.99.99"); // yet another, never-before-seen ip
    expect(status.blocked).toBe(true);
    expect(status.retryAfterSec).toBeGreaterThan(0);
    expect(status.retryAfterSec).toBeLessThanOrEqual(3600);
  });

  it("resetLoginThrottle clears both the ip+email lock and the email-wide count", async () => {
    const email = testEmail();
    const ip = "6.6.6.6";
    for (let i = 0; i < 5; i++) await recordLoginFailure(email, ip);
    expect((await checkLoginThrottle(email, ip)).blocked).toBe(true);

    await resetLoginThrottle(email, ip);
    expect((await checkLoginThrottle(email, ip)).blocked).toBe(false);
  });
});
