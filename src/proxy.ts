// Proxy (renamed from Middleware in Next 16 — see node_modules/next/dist/docs/01-app/…/proxy.md).
// Issues the signed anonymous identity cookie (plan §4.1, D2) on every public/API request, and
// is the early-reject choke point for the admin route guard (plan §7).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/backend/common/auth/admin-session";
import { issueUserCookieValue, USER_COOKIE_MAX_AGE_SECONDS, USER_COOKIE_NAME, verifyUserCookieValue } from "@/backend/common/auth/user-cookie";

const ADMIN_LOGIN_PATHS = new Set(["/admin/login", "/api/admin/auth/login"]);

function isGuardedAdminPath(pathname: string): boolean {
  return (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && !ADMIN_LOGIN_PATHS.has(pathname);
}

/**
 * JWT signature + expiry only (no DB tokenVersion check — that needs a DB read and stays the
 * job of `requireAdmin()` inside every admin controller, which must never be skippable via this
 * layer alone, plan §7). A page path (`/admin/*`) redirects to login; an API path (`/api/admin/*`)
 * gets a 401 JSON body matching the documented error shape.
 */
async function adminGuard(request: NextRequest): Promise<NextResponse | null> {
  if (await verifyAdminCookie(request.cookies.get(ADMIN_COOKIE_NAME)?.value)) return null;

  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "admin session missing or invalid" } }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (isGuardedAdminPath(request.nextUrl.pathname)) {
    const blocked = await adminGuard(request);
    if (blocked) return blocked;
  }

  const cookieValue = request.cookies.get(USER_COOKIE_NAME)?.value;
  if (verifyUserCookieValue(cookieValue)) return NextResponse.next();

  // No valid identity yet: issue one, and forward it on the request headers too (not just the
  // response) so this same request's route handler already sees `request.cookies.get(...)`.
  const { value } = issueUserCookieValue();
  const requestHeaders = new Headers(request.headers);
  const existingCookieHeader = requestHeaders.get("cookie");
  requestHeaders.set("cookie", existingCookieHeader ? `${existingCookieHeader}; ${USER_COOKIE_NAME}=${value}` : `${USER_COOKIE_NAME}=${value}`);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(USER_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: USER_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}

export const config = {
  matcher: ["/", "/watch/:path*", "/api/:path*", "/admin/:path*"],
};
