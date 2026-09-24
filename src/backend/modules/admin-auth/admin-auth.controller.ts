import type { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/backend/common/errors/app-error";
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_MAX_AGE_SECONDS, issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS, ADMIN_DEVICE_COOKIE_NAME, issueAdminDeviceCookieValue } from "@/backend/common/auth/admin-device-cookie";
import { checkOrigin } from "@/backend/common/auth/origin-check";
import { requireAdmin } from "@/backend/common/auth/require-admin";
import { readJsonBody } from "@/backend/common/http/body-limit";
import { getClientIp } from "@/backend/common/http/client-ip";
import { errorResponse, ok } from "@/backend/common/http/response";
import { parseBody } from "@/backend/common/validation/validate";
import { adminLoginBodySchema } from "@/shared/contracts/admin-auth";
import type { AdminAuthService } from "./admin-auth.service";

const ADMIN_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };

export function createAdminAuthController(deps: { adminAuthService: AdminAuthService }) {
  return {
    async login(request: NextRequest) {
      // Applies to login too (plan §7): there's no session cookie yet to protect, but this is
      // exactly the request that plants one, so it's the one a forged cross-site form would target.
      if (!checkOrigin(request)) throw new AppError("BAD_ORIGIN", "origin does not match host");

      const { email, password } = parseBody(adminLoginBodySchema, await readJsonBody(request));
      const deviceCookieValue = request.cookies.get(ADMIN_DEVICE_COOKIE_NAME)?.value ?? null;
      const session = await deps.adminAuthService.login(email, password, getClientIp(request), deviceCookieValue);

      const response = ok<{ id: string; email: string }>({ id: session.adminId, email: session.email });
      response.cookies.set(
        ADMIN_COOKIE_NAME,
        await issueAdminCookieValue({ adminId: session.adminId, tokenVersion: session.tokenVersion }),
        { ...ADMIN_COOKIE_OPTS, maxAge: ADMIN_SESSION_MAX_AGE_SECONDS },
      );
      // Refreshed on every successful login (review MAJOR) — this is what lets the real admin's
      // browser skip the email-wide throttle cap while a stranger's browser still can't.
      response.cookies.set(ADMIN_DEVICE_COOKIE_NAME, issueAdminDeviceCookieValue(session.adminId), {
        ...ADMIN_COOKIE_OPTS,
        maxAge: ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS,
      });
      return response;
    },

    async logout(request: NextRequest): Promise<NextResponse> {
      let response: NextResponse;
      try {
        if (!checkOrigin(request)) throw new AppError("BAD_ORIGIN", "origin does not match host");
        const { adminId } = await requireAdmin(request);
        await deps.adminAuthService.logout(adminId);
        response = ok({});
      } catch (err) {
        if (err instanceof AppError) {
          response = errorResponse(err);
        } else {
          console.error(err);
          response = errorResponse(new AppError("UNAUTHENTICATED", "logout failed"));
        }
      }
      // Cleared on every response from this endpoint, success or failure (review MINOR 4) — a
      // client calling /logout wants the session gone locally regardless of why the server call
      // failed (e.g. an already-expired session shouldn't leave a stale cookie behind either).
      response.cookies.delete({ name: ADMIN_COOKIE_NAME, path: "/" });
      return response;
    },

    async me(request: NextRequest) {
      const { adminId } = await requireAdmin(request);
      return ok(await deps.adminAuthService.me(adminId));
    },
  };
}
