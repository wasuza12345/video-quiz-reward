// proxy.ts is a plain (request) => Promise<NextResponse> function — no Next.js server needed to
// exercise it directly. Covers the P5a admin guard specifically (the vq_uid-issuing half is
// unrelated to this phase and already implicitly covered by every API test that hits a route).
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { prisma } from "@/backend/lib/prisma";
import { proxy } from "@/proxy";

function req(path: string, cookie?: string, method = "GET"): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(url, { headers, method });
}

describe("proxy — admin guard (plan §7)", () => {
  it("/admin/login is exempt — not redirected even with no cookie", async () => {
    const res = await proxy(req("/admin/login"));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("/api/admin/auth/login is exempt — not blocked even with no cookie", async () => {
    const res = await proxy(req("/api/admin/auth/login"));
    expect(res.status).not.toBe(401);
  });

  it("/admin (page) with no cookie → redirected to /admin/login", async () => {
    const res = await proxy(req("/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/login");
  });

  it("/api/admin/videos with no cookie → 401 UNAUTHENTICATED JSON, not a redirect", async () => {
    const res = await proxy(req("/api/admin/videos"));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("/admin with a garbage cookie value → still redirected", async () => {
    const res = await proxy(req("/admin", "vq_admin=not-a-jwt"));
    expect(res.status).toBe(307);
  });

  it("/admin with a validly signed, unexpired admin JWT → passes through (not redirected/401)", async () => {
    const admin = await prisma.admin.create({ data: { email: `proxy-${Date.now()}@test.local`, passwordHash: "x" } });
    const value = await issueAdminCookieValue({ adminId: admin.id, tokenVersion: admin.tokenVersion });

    const res = await proxy(req("/admin", `vq_admin=${value}`));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
    await prisma.admin.delete({ where: { id: admin.id } });
  });

  it("/watch/x (public path) is untouched by the admin guard regardless of cookies", async () => {
    const res = await proxy(req("/watch/some-video"));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("POST /api/admin/auth/logout with a garbage cookie → 401, and clears vq_admin (review MINOR 4: this never reaches the controller)", async () => {
    const res = await proxy(req("/api/admin/auth/logout", "vq_admin=not-a-jwt", "POST"));
    expect(res.status).toBe(401);
    expect(res.cookies.get("vq_admin")?.value).toBe("");
  });

  it("GET /api/admin/auth/logout does NOT clear the cookie, even with one present (review round 2 MINOR A: a cross-site <img> GET must not force a logout)", async () => {
    const res = await proxy(req("/api/admin/auth/logout", "vq_admin=not-a-jwt", "GET"));
    expect(res.status).toBe(401);
    expect(res.cookies.get("vq_admin")).toBeUndefined();
  });

  it("POST /api/admin/auth/logout with NO cookie at all does not set a needless clearing Set-Cookie", async () => {
    const res = await proxy(req("/api/admin/auth/logout", undefined, "POST"));
    expect(res.status).toBe(401);
    expect(res.cookies.get("vq_admin")).toBeUndefined();
  });

  it("a rejected /api/admin/videos request does NOT clear the cookie (only logout does)", async () => {
    const res = await proxy(req("/api/admin/videos", "vq_admin=not-a-jwt"));
    expect(res.status).toBe(401);
    expect(res.cookies.get("vq_admin")).toBeUndefined();
  });
});
