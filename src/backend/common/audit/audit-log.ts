// Admin audit trail (plan §3 AdminAuditLog). One row per mutation in the video/quiz admin
// services. This helper (an unexecuted `PrismaPromise`, batched via the plain `$transaction([...])`
// array form) covers every mutation that has nothing conditional to gate — create, publish/archive,
// feature. The three that DO gate on a lock check (video/question update, question delete) instead
// write their audit row directly inside their own interactive `prisma.$transaction(async (tx) => …)`
// in their repository, so a blocked (locked) write commits nothing at all rather than committing an
// audit row for a mutation that didn't actually happen.
import type { Prisma } from "@/backend/lib/prisma";
import { prisma } from "@/backend/lib/prisma";

export type AuditAction =
  | "video.create"
  | "video.update"
  | "video.publish"
  | "video.archive"
  | "video.feature"
  | "question.create"
  | "question.update"
  | "question.delete";

export interface AuditContext {
  adminId: string;
}

/** Returns an unexecuted Prisma write — the caller includes it in its own `$transaction([...])`
 * array alongside the entity write it's auditing. */
export function auditLogEntry(ctx: AuditContext, action: AuditAction, entity: string, entityId: string, diff: unknown): Prisma.PrismaPromise<unknown> {
  return prisma.adminAuditLog.create({
    data: { adminId: ctx.adminId, action, entity, entityId, diff: diff === undefined ? null : JSON.stringify(diff) },
  });
}
