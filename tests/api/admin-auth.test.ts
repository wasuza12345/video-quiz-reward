import { afterAll, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/admin/auth/me/route";
import { POST as postLogin } from "@/app/api/admin/auth/login/route";
import { POST as postLogout } from "@/app/api/admin/auth/logout/route";
import { ADMIN_COOKIE_NAME } from "@/backend/common/auth/admin-session";
import { prisma } from "@/backend/lib/prisma";
import { adminRequest, createTestAdmin } from "./helpers";

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

  it("logout without a matching origin → 403 BAD_ORIGIN (never gets to revoke)", async () => {
    const admin = await createTestAdmin();
    const login = await postLogin(adminRequest(LOGIN_URL, { body: { email: admin.email, password: admin.password } }));
    const cookie = login.cookies.get(ADMIN_COOKIE_NAME)!.value;

    const res = await postLogout(adminRequest(LOGOUT_URL, { adminCookie: cookie, origin: null }));
    expect(res.status).toBe(403);
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
