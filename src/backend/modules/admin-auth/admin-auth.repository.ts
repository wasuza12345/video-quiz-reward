import { prisma } from "@/backend/lib/prisma";
import type { AdminAuthRepository } from "./admin-auth.interface";

export function createAdminAuthRepository(): AdminAuthRepository {
  return {
    async findByEmail(email) {
      return prisma.admin.findUnique({ where: { email } });
    },

    async findById(id) {
      return prisma.admin.findUnique({ where: { id }, select: { id: true, email: true } });
    },

    async bumpTokenVersion(id) {
      const updated = await prisma.admin.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
      return updated.tokenVersion;
    },
  };
}
