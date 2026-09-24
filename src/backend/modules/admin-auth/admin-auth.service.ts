import { AppError } from "@/backend/common/errors/app-error";
import { checkLoginThrottle, recordLoginFailure, resetLoginThrottle } from "@/backend/common/auth/login-throttle";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/backend/lib/password";
import type { AdminMeResponse } from "@/shared/contracts/admin-auth";
import type { AdminAuthRepository } from "./admin-auth.interface";

export interface AdminSession {
  adminId: string;
  email: string;
  tokenVersion: number;
}

export interface AdminAuthService {
  login(email: string, password: string, ip: string): Promise<AdminSession>;
  logout(adminId: string): Promise<void>;
  me(adminId: string): Promise<AdminMeResponse>;
}

export function createAdminAuthService(deps: { adminAuthRepo: AdminAuthRepository }): AdminAuthService {
  return {
    async login(emailInput, password, ip) {
      const email = emailInput.toLowerCase();

      const throttle = await checkLoginThrottle(email, ip);
      if (throttle.blocked) {
        throw new AppError("TOO_MANY_ATTEMPTS", "too many login attempts", { retryAfterSec: throttle.retryAfterSec });
      }

      const admin = await deps.adminAuthRepo.findByEmail(email);
      // Always compare against a real bcrypt hash — a real one when the email exists, a fixed
      // decoy when it doesn't — so an unknown email takes the same time as a wrong password.
      const passwordOk = await verifyPassword(password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH);

      if (!admin || !passwordOk) {
        await recordLoginFailure(email, ip);
        throw new AppError("INVALID_CREDENTIALS", "invalid email or password");
      }

      await resetLoginThrottle(email, ip);
      return { adminId: admin.id, email: admin.email, tokenVersion: admin.tokenVersion };
    },

    async logout(adminId) {
      await deps.adminAuthRepo.bumpTokenVersion(adminId);
    },

    async me(adminId) {
      const admin = await deps.adminAuthRepo.findById(adminId);
      if (!admin) throw new AppError("UNAUTHENTICATED", "admin no longer exists");
      return admin;
    },
  };
}
