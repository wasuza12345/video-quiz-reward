import type { NextRequest } from "next/server";
import { prisma } from "@/backend/lib/prisma";
import { AppError } from "@/backend/common/errors/app-error";
import { ADMIN_COOKIE_NAME, verifyAdminCookieValue } from "./admin-session";

/**
 * The full admin identity check: JWT signature/expiry **and** the DB `tokenVersion` (so a
 * logout/password-change immediately invalidates every other still-unexpired JWT). Every admin
 * controller calls this itself — proxy.ts's guard is JWT-only and must never be the only check
 * (plan §7).
 */
export async function requireAdmin(request: NextRequest): Promise<{ adminId: string }> {
  const payload = await verifyAdminCookieValue(request.cookies.get(ADMIN_COOKIE_NAME)?.value);
  if (!payload) throw new AppError("UNAUTHENTICATED", "admin session missing or invalid");

  const admin = await prisma.admin.findUnique({ where: { id: payload.adminId }, select: { tokenVersion: true } });
  if (!admin || admin.tokenVersion !== payload.tokenVersion) {
    throw new AppError("UNAUTHENTICATED", "admin session has been revoked");
  }
  return { adminId: payload.adminId };
}
