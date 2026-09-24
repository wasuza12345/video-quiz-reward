import { prisma } from "@/backend/lib/prisma";
import type { UserRepository } from "./user.interface";

export function createUserRepository(): UserRepository {
  return {
    async ensure(userId) {
      await prisma.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
    },
  };
}
