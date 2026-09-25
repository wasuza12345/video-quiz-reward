// A structural guard mirroring admin-route-guard.test.ts's discovery approach, but for the origin
// check instead of the session check: every mutating admin route (POST/PATCH/DELETE), except auth/login, must reject a
// request with a valid admin session but no Origin header — 403 BAD_ORIGIN. GET routes are
// excluded since origin-check only ever applies to mutations (plan §7).
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { ADMIN_COOKIE_NAME, issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { prisma } from "@/backend/lib/prisma";

const ADMIN_API_ROOT = join(process.cwd(), "src/app/api/admin");
const EXEMPT = new Set(["auth/login/route.ts"]);
const MUTATING_METHODS = ["POST", "PATCH", "PUT", "DELETE"] as const;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRouteFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

const routeFiles = findRouteFiles(ADMIN_API_ROOT).filter((f) => !EXEMPT.has(relative(ADMIN_API_ROOT, f)));

describe("every mutating admin route rejects a missing Origin", () => {
  afterAll(() => prisma.$disconnect());

  it("found at least one guarded route file — a broken discovery path must not make this suite vacuously pass", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)("%s", async (file) => {
    const admin = await prisma.admin.create({ data: { email: `origin-guard-${Date.now()}-${Math.random()}@test.local`, passwordHash: "x", tokenVersion: 0 } });
    const validJwt = await issueAdminCookieValue({ adminId: admin.id, tokenVersion: 0 });

    const mod = (await import(file)) as Record<string, unknown>;
    const relPath = relative(ADMIN_API_ROOT, file).replace(/\/route\.ts$/, "");
    const url = `http://guard-test/api/admin/${relPath}`;

    let checked = 0;
    for (const method of MUTATING_METHODS) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      checked += 1;

      // No Origin header, but a genuinely valid session — isolates this to the origin check alone.
      const headers = new Headers({ host: "guard-test", cookie: `${ADMIN_COOKIE_NAME}=${validJwt}` });
      const req = new (await import("next/server")).NextRequest(url, { method, headers, body: "{}" }) as NextRequest;

      const res = await (handler as (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>)(req, {
        params: Promise.resolve({ id: "guard-test-id" }),
      });
      expect(res.status, `${relative(ADMIN_API_ROOT, file)} ${method} should 403 with no Origin, got ${res.status}`).toBe(403);
      expect((await res.json()).error.code, `${relative(ADMIN_API_ROOT, file)} ${method}`).toBe("BAD_ORIGIN");
    }

    // A GET-only route (e.g. a detail endpoint) legitimately checks nothing here — unlike
    // admin-route-guard.test.ts, not every route file need have a mutating handler.
    void checked;

    await prisma.admin.delete({ where: { id: admin.id } });
  });
});
