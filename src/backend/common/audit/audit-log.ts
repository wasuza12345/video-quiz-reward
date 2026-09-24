// Admin audit trail (plan §3 AdminAuditLog, review round 2 MINOR 1 — "IMPLEMENT it"). One row per
// mutation in the video/quiz admin services, written in the same `$transaction([...])` batch as
// the mutation itself wherever the repository can express it that way, so a written mutation is
// never silently un-audited.
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
