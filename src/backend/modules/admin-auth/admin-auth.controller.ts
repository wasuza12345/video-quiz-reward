import type { NextRequest } from "next/server";
import { AppError } from "@/backend/common/errors/app-error";
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_MAX_AGE_SECONDS, issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { checkOrigin } from "@/backend/common/auth/origin-check";
import { requireAdmin } from "@/backend/common/auth/require-admin";
import { readJsonBody } from "@/backend/common/http/body-limit";
import { getClientIp } from "@/backend/common/http/client-ip";
import { ok } from "@/backend/common/http/response";
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
      const session = await deps.adminAuthService.login(email, password, getClientIp(request));

      const response = ok<{ id: string; email: string }>({ id: session.adminId, email: session.email });
      response.cookies.set(
        ADMIN_COOKIE_NAME,
        await issueAdminCookieValue({ adminId: session.adminId, tokenVersion: session.tokenVersion }),
        { ...ADMIN_COOKIE_OPTS, maxAge: ADMIN_SESSION_MAX_AGE_SECONDS },
      );
      return response;
    },

    async logout(request: NextRequest) {
      if (!checkOrigin(request)) throw new AppError("BAD_ORIGIN", "origin does not match host");
      const { adminId } = await requireAdmin(request);
      await deps.adminAuthService.logout(adminId);

      const response = ok({});
      response.cookies.delete({ name: ADMIN_COOKIE_NAME, path: "/" });
      return response;
    },

    async me(request: NextRequest) {
      const { adminId } = await requireAdmin(request);
      return ok(await deps.adminAuthService.me(adminId));
    },
  };
}
