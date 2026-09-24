import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/lib/prisma";
import type { VideoStatus } from "@/backend/domain/resume-policy";
import { auditLogEntry } from "@/backend/common/audit/audit-log";
import type { AdminQuestionRow, AdminVideoRow, AdminVideoWithQuestions, CreateVideoInput, UpdateVideoInput, VideoRepository, VideoRow } from "./video.interface";

function toRow(v: {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
  status: string;
  isFeatured: boolean;
  _count: { questions: number };
}): VideoRow {
  return {
    id: v.id,
    youtubeId: v.youtubeId,
    title: v.title,
    channelName: v.channelName,
    durationSec: v.durationSec,
    rewardPoints: v.rewardPoints,
    status: v.status as VideoStatus,
    isFeatured: v.isFeatured,
    questionCount: v._count.questions,
  };
}

function toAdminRow(v: Parameters<typeof toRow>[0] & { publishedAt: Date | null; _count: { questions: number; sessions: number } }): AdminVideoRow {
  return { ...toRow(v), publishedAt: v.publishedAt, sessionCount: v._count.sessions };
}

const ADMIN_COUNTS = { _count: { select: { questions: true, sessions: true } } } as const;

export function createVideoRepository(): VideoRepository {
  return {
    async listPublished() {
      const videos = await prisma.video.findMany({
        where: { status: "published" },
        orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
        include: { _count: { select: { questions: true } } },
      });
      return videos.map(toRow);
    },

    async findById(videoId) {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: { _count: { select: { questions: true } } },
      });
      return video ? toRow(video) : null;
    },

    async listAdmin(page, pageSize) {
      const [items, total] = await Promise.all([
        prisma.video.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: ADMIN_COUNTS,
        }),
        prisma.video.count(),
      ]);
      return { items: items.map(toAdminRow), total };
    },

    async findAdminById(id) {
      const video = await prisma.video.findUnique({
        where: { id },
        include: {
          ...ADMIN_COUNTS,
          questions: { orderBy: { triggerSec: "asc" }, include: { choices: { orderBy: { label: "asc" } } } },
        },
      });
      if (!video) return null;
      const questions: AdminQuestionRow[] = video.questions.map((q) => ({
        id: q.id,
        triggerSec: q.triggerSec,
        prompt: q.prompt,
        correctChoice: q.correctChoice,
        choices: q.choices.map((c) => ({ label: c.label, text: c.text })),
      }));
      const result: AdminVideoWithQuestions = { ...toAdminRow(video), questions };
      return result;
    },

    async create(input: CreateVideoInput, audit) {
      const id = randomUUID(); // generated client-side so the audit row can reference it in the same transaction
      const [video] = await prisma.$transaction([
        prisma.video.create({ data: { id, ...input, status: "draft", isFeatured: false }, include: ADMIN_COUNTS }),
        auditLogEntry(audit, "video.create", "video", id, input),
      ]);
      return toAdminRow(video);
    },

    async update(id, input: UpdateVideoInput, audit, requireUnlocked) {
      if (requireUnlocked) {
        // The write itself is the atomic conditional check (review round 2 MINOR 3) — not a
        // separate probe followed by a plain update, which would leave its own small gap. A
        // session created concurrently makes this match 0 rows instead of applying `input`.
        const result = await prisma.video.updateMany({ where: { id, sessions: { none: {} } }, data: input });
        if (result.count === 0) return null;
      } else {
        await prisma.video.update({ where: { id }, data: input });
      }
      const [video] = await prisma.$transaction([prisma.video.findUniqueOrThrow({ where: { id }, include: ADMIN_COUNTS }), auditLogEntry(audit, "video.update", "video", id, input)]);
      return toAdminRow(video);
    },

    async setStatus(id, status, action, audit) {
      const [video] = await prisma.$transaction([
        prisma.video.update({
          where: { id },
          data: {
            status,
            publishedAt: status === "published" ? new Date() : undefined,
            // Archiving retires a video from the public list entirely — it can't stay "the" featured one (review round 2 MINOR 4).
            isFeatured: status === "archived" ? false : undefined,
          },
          include: ADMIN_COUNTS,
        }),
        auditLogEntry(audit, action, "video", id, { status }),
      ]);
      return toAdminRow(video);
    },

    async setFeatured(id, audit) {
      const [, video] = await prisma.$transaction([
        prisma.video.updateMany({ where: { isFeatured: true, id: { not: id } }, data: { isFeatured: false } }),
        prisma.video.update({ where: { id }, data: { isFeatured: true }, include: ADMIN_COUNTS }),
        auditLogEntry(audit, "video.feature", "video", id, { isFeatured: true }),
      ]);
      return toAdminRow(video);
    },
  };
}
