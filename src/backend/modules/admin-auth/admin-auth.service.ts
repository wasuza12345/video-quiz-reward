import { AppError } from "@/backend/common/errors/app-error";
import { verifyAdminDeviceCookieValue } from "@/backend/common/auth/admin-device-cookie";
import { reserveLoginAttempt, resetLoginThrottle } from "@/backend/common/auth/login-throttle";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/backend/lib/password";
import type { AdminMeResponse } from "@/shared/contracts/admin-auth";
import type { AdminAuthRepository } from "./admin-auth.interface";

export interface AdminSession {
  adminId: string;
  email: string;
  tokenVersion: number;
}

export interface AdminAuthService {
  login(email: string, password: string, ip: string, deviceCookieValue: string | null): Promise<AdminSession>;
  logout(adminId: string): Promise<void>;
  me(adminId: string): Promise<AdminMeResponse>;
}

export function createAdminAuthService(deps: { adminAuthRepo: AdminAuthRepository }): AdminAuthService {
  return {
    async login(emailInput, password, ip, deviceCookieValue) {
      const email = emailInput.toLowerCase();
      const admin = await deps.adminAuthRepo.findByEmail(email);

      // A recognized device for THIS admin skips the email-wide cap — otherwise
      // anyone who learns the admin's email can lock the real admin out from anywhere. The
      // per-(email, ip) lock below still applies regardless, so this never disables throttling.
      const skipEmailCap = !!admin && verifyAdminDeviceCookieValue(deviceCookieValue, admin.id);

      // Reserved BEFORE the password check — a blocked attempt never touches
      // bcrypt, and the reservation itself is what gets recorded as this attempt's failure if the
      // credentials turn out to be wrong (no separate "record failure" step after the fact).
      const reservation = await reserveLoginAttempt(email, ip, { skipEmailCap });
      if (reservation.blocked) {
        throw new AppError("TOO_MANY_ATTEMPTS", "too many login attempts", { retryAfterSec: reservation.retryAfterSec });
      }

      // Always compare against a real bcrypt hash — a real one when the email exists, a fixed
      // decoy when it doesn't — so an unknown email takes the same time as a wrong password.
      const passwordOk = await verifyPassword(password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!admin || !passwordOk) {
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
