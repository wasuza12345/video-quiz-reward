// A structural guard, not a feature test: every admin route — present now or
// added later — must reject a validly-signed-but-REVOKED admin JWT with 401. It discovers
// route files on disk rather than importing them by name one at a time, specifically so it stays
// green (or fails loudly) as new admin routes are added, without anyone remembering to update it.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { ADMIN_COOKIE_NAME, issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { prisma } from "@/backend/lib/prisma";

const ADMIN_API_ROOT = join(process.cwd(), "src/app/api/admin");
// The only admin route that must NOT require an existing session — it's how you get one.
const EXEMPT = new Set(["auth/login/route.ts"]);
const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

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

describe("every admin API route requires a non-revoked admin session", () => {
  afterAll(() => prisma.$disconnect());

  it("found at least one guarded route file — a broken discovery path must not make this suite vacuously pass", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)("%s", async (file) => {
    const admin = await prisma.admin.create({ data: { email: `guard-${Date.now()}-${Math.random()}@test.local`, passwordHash: "x", tokenVersion: 5 } });
    // Validly signed, unexpired, but for a tokenVersion the DB no longer matches — exactly what a
    // JWT looks like right after logout/password-change (requireAdmin's own check, not the proxy's).
    const revokedJwt = await issueAdminCookieValue({ adminId: admin.id, tokenVersion: 4 });

    const mod = (await import(file)) as Record<string, unknown>;
    const relPath = relative(ADMIN_API_ROOT, file).replace(/\/route\.ts$/, "");
    const url = `http://guard-test/api/admin/${relPath}`;

    let checked = 0;
    for (const method of HTTP_METHODS) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      checked += 1;

      const headers = new Headers({ host: "guard-test", origin: "http://guard-test", cookie: `${ADMIN_COOKIE_NAME}=${revokedJwt}` });
      const hasBody = method === "POST" || method === "PATCH" || method === "PUT";
      const req = new (await import("next/server")).NextRequest(url, { method, headers, body: hasBody ? "{}" : undefined }) as NextRequest;

      const res = await (handler as (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>)(req, {
        params: Promise.resolve({ id: "guard-test-id" }),
      });
      expect(res.status, `${relative(ADMIN_API_ROOT, file)} ${method} should 401 a revoked session, got ${res.status}`).toBe(401);
    }
    expect(checked, `${relative(ADMIN_API_ROOT, file)} exports no HTTP method handlers — is this route file actually wired up?`).toBeGreaterThan(0);

    await prisma.admin.delete({ where: { id: admin.id } });
  });
});
