// Proxy (renamed from Middleware in Next 16 — see node_modules/next/dist/docs/01-app/…/proxy.md).
// Issues the signed anonymous identity cookie (plan §4.1, D2) on every public/API request, and
// is the single choke point for the admin route guard (plan §7 — stub until P5a).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { issueUserCookieValue, USER_COOKIE_MAX_AGE_SECONDS, USER_COOKIE_NAME, verifyUserCookieValue } from "@/backend/common/auth/user-cookie";

const ADMIN_LOGIN_PATHS = new Set(["/admin/login", "/api/admin/auth/login"]);

function isGuardedAdminPath(pathname: string): boolean {
  return (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && !ADMIN_LOGIN_PATHS.has(pathname);
}

/**
 * TODO(P5a): verify the `vq_admin` JWT + `tokenVersion` here (plan §7) and return a redirect/401
 * when it's missing or invalid. Until then this is a deliberate no-op — admin routes are NOT
 * protected by the proxy yet; do not deploy admin UI/API ahead of P5a landing.
 */
function adminGuardStub(): NextResponse | null {
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  if (isGuardedAdminPath(request.nextUrl.pathname)) {
    const blocked = adminGuardStub();
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
