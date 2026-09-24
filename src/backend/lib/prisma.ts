import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../../generated/prisma/client";
import { getDbEnv } from "../config/env";

function createPrismaClient(): PrismaClient {
  const { url, authToken, isRemote } = getDbEnv();
  console.info(`[db] using ${isRemote ? "turso" : "local file"}`);
  const adapter = new PrismaLibSql({ url, authToken });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Singleton: reuse one client across hot reloads in dev.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
