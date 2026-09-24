import { afterAll, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/admin/auth/me/route";
import { POST as postLogin } from "@/app/api/admin/auth/login/route";
import { POST as postLogout } from "@/app/api/admin/auth/logout/route";
import { ADMIN_COOKIE_NAME } from "@/backend/common/auth/admin-session";
import { ADMIN_DEVICE_COOKIE_NAME } from "@/backend/common/auth/admin-device-cookie";
import { emailThrottleKey } from "@/backend/common/auth/login-throttle";
import { prisma } from "@/backend/lib/prisma";
import { adminRequest, createTestAdmin } from "./helpers";

/** Seeds the email-wide throttle counter directly at the cap, instead of driving 50 real failed
 * logins through bcrypt (login-throttle.test.ts already proves the counter itself reaches this
 * state correctly and cheaply) — this test is only about what happens once it's there. */
async function primeEmailCapAtLimit(email: string) {
  await prisma.loginThrottle.create({ data: { key: emailThrottleKey(email), failCount: 50, windowStart: new Date() } });
}

const LOGIN_URL = "http://t/api/admin/auth/login";
const LOGOUT_URL = "http://t/api/admin/auth/logout";
const ME_URL = "http://t/api/admin/auth/me";

describe("POST /api/admin/auth/login", () => {
  afterAll(() => prisma.$disconnect());

  it("correct credentials + matching origin → 200, a vq_admin cookie, and the admin identity", async () => {
    const admin = await createTestAdmin();
    const res = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: admin.id, email: admin.email });
    const cookie = res.cookies.get(ADMIN_COOKIE_NAME);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
  });

  it("a successful login also sets a vq_admin_dev 'known device' cookie", async () => {
    const admin = await createTestAdmin();
    const res = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password } }));
    const device = res.cookies.get(ADMIN_DEVICE_COOKIE_NAME);
    expect(device?.value).toBeTruthy();
    expect(device?.httpOnly).toBe(true);
    expect(device?.maxAge).toBe(60 * 60 * 24 * 90);
  });

  it("wrong password → 401 INVALID_CREDENTIALS", async () => {
    const admin = await createTestAdmin();
    const res = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: "not the password" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("unknown email → 401 INVALID_CREDENTIALS (dummy bcrypt path, same shape as a wrong password)", async () => {
    const res = await postLogin(adminRequest(LOGIN_URL, { body: { email: "nobody@test.local", password: "whatever12345" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("missing Origin header → 403 BAD_ORIGIN (checked before credentials)", async () => {
    const admin = await createTestAdmin();
    const res = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, origin: null }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("BAD_ORIGIN");
  });

  it("Origin host different from the request Host → 403 BAD_ORIGIN", async () => {
    const admin = await createTestAdmin();
    const res = await postLogin(
      adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("BAD_ORIGIN");
  });

  it("5 failed attempts from the same ip+email lock out the 6th, even with the correct password (plan §7)", async () => {
    const admin = await createTestAdmin();
    const ip = `1.2.3.${Math.floor(Math.random() * 255)}`;
    for (let i = 0; i < 5; i++) {
      const res = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: "wrong" }, ip }));
      expect(res.status).toBe(401);
    }
    const locked = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, ip }));
    expect(locked.status).toBe(429);
    expect((await locked.json()).error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("the ip+email lock does not affect a different ip attempting the same email", async () => {
    const admin = await createTestAdmin();
    const lockedIp = `9.9.9.${Math.floor(Math.random() * 255)}`;
    for (let i = 0; i < 5; i++) {
      await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: "wrong" }, ip: lockedIp }));
    }
    const otherIp = await postLogin(
      adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, ip: `8.8.8.${Math.floor(Math.random() * 255)}` }),
    );
    expect(otherIp.status).toBe(200);
  });

  it("review MAJOR: a known-device cookie skips the email-wide 50/hour cap", async () => {
    const admin = await createTestAdmin();
    const first = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, ip: "50.50.50.1" }));
    const deviceCookie = first.cookies.get(ADMIN_DEVICE_COOKIE_NAME)!.value;

    // Simulates an attacker having already tripped the email-wide cap from many other ips —
    // login-throttle.test.ts proves 50 real failures actually reach this state; this test is
    // about what happens once it's there, so it seeds it directly rather than paying for 50 more
    // bcrypt compares here too.
    await primeEmailCapAtLimit(admin.email);

    const withDevice = await postLogin(
      adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, ip: "50.50.50.2", deviceCookie }),
    );
    expect(withDevice.status).toBe(200);
  });

  it("review MAJOR: without a device cookie, the same correct credentials hit the tripped email cap", async () => {
    // A separate admin from the test above — a successful login clears the throttle rows, so
    // sharing one admin across both assertions would let the first (device-cookie) success reset
    // the cap this test needs to still be tripped.
    const admin = await createTestAdmin();
    await primeEmailCapAtLimit(admin.email);

    const withoutDevice = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, ip: "50.50.50.3" }));
    expect(withoutDevice.status).toBe(429);
    expect((await withoutDevice.json()).error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("a device cookie issued for a DIFFERENT admin does not skip this admin's cap", async () => {
    const admin = await createTestAdmin();
    const otherAdmin = await createTestAdmin();
    const otherLogin = await postLogin(adminRequest(LOGIN_URL, { body: { email: otherAdmin.email, password: otherAdmin.password }, ip: "70.0.0.1" }));
    const otherDeviceCookie = otherLogin.cookies.get(ADMIN_DEVICE_COOKIE_NAME)!.value;

    await primeEmailCapAtLimit(admin.email);
    const res = await postLogin(
      adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password }, ip: "71.0.0.99", deviceCookie: otherDeviceCookie }),
    );
    expect(res.status).toBe(429);
  });
});

describe("admin session: GET /me, POST /logout, tokenVersion revoke (plan §7)", () => {
  afterAll(() => prisma.$disconnect());

  it("GET /me with no cookie → 401 UNAUTHENTICATED", async () => {
    const res = await getMe(adminRequest(ME_URL));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("GET /me with a garbage cookie value → 401 UNAUTHENTICATED", async () => {
    const res = await getMe(adminRequest(ME_URL, { adminCookie: "not-a-real-jwt" }));
    expect(res.status).toBe(401);
  });

  it("GET /me with a fresh login cookie → 200 with the admin's identity", async () => {
    const admin = await createTestAdmin();
    const login = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password } }));
    const cookie = login.cookies.get(ADMIN_COOKIE_NAME)!.value;

    const res = await getMe(adminRequest(ME_URL, { adminCookie: cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: admin.id, email: admin.email });
  });

  it("logout without a matching origin → 403 BAD_ORIGIN (never gets to revoke), but the cookie is still cleared (review MINOR 4)", async () => {
    const admin = await createTestAdmin();
    const login = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password } }));
    const cookie = login.cookies.get(ADMIN_COOKIE_NAME)!.value;

    const res = await postLogout(adminRequest(LOGOUT_URL, { adminCookie: cookie, origin: null }));
    expect(res.status).toBe(403);
    expect(res.cookies.get(ADMIN_COOKIE_NAME)?.value).toBe("");
  });

  it("logout with no session at all (already logged out / expired) → 401, cookie still cleared (review MINOR 4)", async () => {
    const res = await postLogout(adminRequest(LOGOUT_URL, { adminCookie: "not-a-real-jwt" }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(ADMIN_COOKIE_NAME)?.value).toBe("");
  });

  it("logout bumps tokenVersion so the old (still unexpired, correctly signed) JWT stops working", async () => {
    const admin = await createTestAdmin();
    const login = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password } }));
    const oldCookie = login.cookies.get(ADMIN_COOKIE_NAME)!.value;

    const logoutRes = await postLogout(adminRequest(LOGOUT_URL, { adminCookie: oldCookie }));
    expect(logoutRes.status).toBe(200);

    // The logout response itself clears the cookie — but the real-world attack this defends
    // against is an OLD, already-issued JWT (e.g. stolen, or a second still-open tab) being
    // replayed after logout, so re-send that same pre-logout value on its own request.
    const replayed = await getMe(adminRequest(ME_URL, { adminCookie: oldCookie }));
    expect(replayed.status).toBe(401);
    expect((await replayed.json()).error.code).toBe("UNAUTHENTICATED");
  });
});
