import { prisma } from "@/backend/lib/prisma";
import type { VideoStatus } from "@/backend/domain/resume-policy";
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

    async create(input: CreateVideoInput) {
      const video = await prisma.video.create({
        data: { ...input, status: "draft", isFeatured: false },
        include: ADMIN_COUNTS,
      });
      return toAdminRow(video);
    },

    async update(id, input: UpdateVideoInput) {
      const video = await prisma.video.update({ where: { id }, data: input, include: ADMIN_COUNTS });
      return toAdminRow(video);
    },

    async setStatus(id, status) {
      const video = await prisma.video.update({
        where: { id },
        data: { status, publishedAt: status === "published" ? new Date() : undefined },
        include: ADMIN_COUNTS,
      });
      return toAdminRow(video);
    },

    async setFeatured(id) {
      const [, video] = await prisma.$transaction([
        prisma.video.updateMany({ where: { isFeatured: true, id: { not: id } }, data: { isFeatured: false } }),
        prisma.video.update({ where: { id }, data: { isFeatured: true }, include: ADMIN_COUNTS }),
      ]);
      return toAdminRow(video);
    },
  };
}
