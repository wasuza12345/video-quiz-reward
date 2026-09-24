import { prisma } from "@/backend/lib/prisma";
import type { VideoStatus } from "@/backend/domain/resume-policy";
import type { VideoRepository, VideoRow } from "./video.interface";

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
  };
}
