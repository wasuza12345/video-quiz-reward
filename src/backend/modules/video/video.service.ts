import { Prisma } from "@/backend/lib/prisma";
import { AppError } from "@/backend/common/errors/app-error";
import { fetchYoutubeOembed, parseYoutubeId } from "@/backend/lib/youtube";
import type { AdminCreateVideoBody, AdminUpdateVideoBody, AdminVideoDetail, AdminVideoListItem, Paged } from "@/shared/contracts/admin";
import type { RewardRepository } from "../reward/reward.interface";
import type { AdminVideoRow, AdminVideoWithQuestions, VideoRepository, VideoRow } from "./video.interface";

export interface PublicVideoItem {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
  rewarded: boolean;
  questionCount: number;
}

export interface VideoListResult {
  featured: PublicVideoItem | null;
  videos: PublicVideoItem[];
}

function toPublicItem(row: VideoRow, rewarded: boolean): PublicVideoItem {
  return {
    id: row.id,
    youtubeId: row.youtubeId,
    title: row.title,
    channelName: row.channelName,
    durationSec: row.durationSec,
    rewardPoints: row.rewardPoints,
    rewarded,
    questionCount: row.questionCount,
  };
}

function toAdminListItem(row: AdminVideoRow): AdminVideoListItem {
  return {
    id: row.id,
    youtubeId: row.youtubeId,
    title: row.title,
    channelName: row.channelName,
    durationSec: row.durationSec,
    rewardPoints: row.rewardPoints,
    status: row.status,
    isFeatured: row.isFeatured,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    questionCount: row.questionCount,
    sessionCount: row.sessionCount,
    locked: row.sessionCount > 0,
  };
}

function toAdminDetail(row: AdminVideoWithQuestions): AdminVideoDetail {
  return { ...toAdminListItem(row), questions: row.questions };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export interface VideoService {
  listVideos(userId: string): Promise<VideoListResult>;
  adminList(page: number, pageSize: number): Promise<Paged<AdminVideoListItem>>;
  adminDetail(id: string): Promise<AdminVideoDetail>;
  adminCreate(input: AdminCreateVideoBody): Promise<AdminVideoListItem>;
  adminUpdate(id: string, input: AdminUpdateVideoBody): Promise<AdminVideoListItem>;
  adminPublish(id: string): Promise<AdminVideoListItem>;
  adminArchive(id: string): Promise<AdminVideoListItem>;
  adminFeature(id: string): Promise<AdminVideoListItem>;
}

export function createVideoService(deps: { videoRepo: VideoRepository; rewardRepo: RewardRepository }): VideoService {
  async function requireAdminRow(id: string): Promise<AdminVideoWithQuestions> {
    const row = await deps.videoRepo.findAdminById(id);
    if (!row) throw new AppError("VIDEO_NOT_FOUND", "video not found");
    return row;
  }

  return {
    async listVideos(userId) {
      const rows = await deps.videoRepo.listPublished();
      const rewardedIds = await deps.rewardRepo.findRewardedVideoIds(
        userId,
        rows.map((r) => r.id),
      );
      // `videos` carries every published video, featured included — the client filters it out
      // of the grid below (spec.md: "The featured video is not repeated in the list below").
      const videos = rows.map((r) => toPublicItem(r, rewardedIds.has(r.id)));
      const featuredIndex = rows.findIndex((r) => r.isFeatured);
      return { featured: featuredIndex >= 0 ? videos[featuredIndex] : null, videos };
    },

    async adminList(page, pageSize) {
      const { items, total } = await deps.videoRepo.listAdmin(page, pageSize);
      return { items: items.map(toAdminListItem), page, pageSize, total };
    },

    async adminDetail(id) {
      return toAdminDetail(await requireAdminRow(id));
    },

    async adminCreate(input) {
      const youtubeId = parseYoutubeId(input.youtubeUrl);
      if (!youtubeId) {
        throw new AppError("VALIDATION_ERROR", "invalid YouTube URL", { issues: [{ path: "youtubeUrl", message: "invalid YouTube URL" }] });
      }
      const oembed = await fetchYoutubeOembed(youtubeId);
      if (!oembed) {
        throw new AppError("VALIDATION_ERROR", "video not found or not embeddable", {
          issues: [{ path: "youtubeUrl", message: "video not found or not embeddable" }],
        });
      }

      try {
        const row = await deps.videoRepo.create({
          youtubeId,
          title: input.title?.trim() || oembed.title,
          channelName: oembed.channelName,
          durationSec: input.durationSec,
          rewardPoints: input.rewardPoints,
        });
        return toAdminListItem(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("VALIDATION_ERROR", "this video has already been added", { issues: [{ path: "youtubeUrl", message: "already added" }] });
        }
        throw err;
      }
    },

    async adminUpdate(id, input) {
      const current = await requireAdminRow(id);
      const locked = current.sessionCount > 0;
      if (locked && (input.youtubeUrl !== undefined || input.durationSec !== undefined)) {
        throw new AppError("VIDEO_LOCKED", "this video has viewers and its link/length can no longer be changed", {
          sessionCount: current.sessionCount,
        });
      }

      let youtubeId: string | undefined;
      let channelName: string | undefined;
      if (input.youtubeUrl !== undefined) {
        const parsed = parseYoutubeId(input.youtubeUrl);
        if (!parsed) throw new AppError("VALIDATION_ERROR", "invalid YouTube URL", { issues: [{ path: "youtubeUrl", message: "invalid YouTube URL" }] });
        const oembed = await fetchYoutubeOembed(parsed);
        if (!oembed) {
          throw new AppError("VALIDATION_ERROR", "video not found or not embeddable", {
            issues: [{ path: "youtubeUrl", message: "video not found or not embeddable" }],
          });
        }
        youtubeId = parsed;
        channelName = oembed.channelName;
      }

      try {
        const row = await deps.videoRepo.update(id, {
          youtubeId,
          channelName,
          title: input.title,
          durationSec: input.durationSec,
          rewardPoints: input.rewardPoints,
        });
        return toAdminListItem(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("VALIDATION_ERROR", "this video has already been added", { issues: [{ path: "youtubeUrl", message: "already added" }] });
        }
        throw err;
      }
    },

    async adminPublish(id) {
      await requireAdminRow(id);
      return toAdminListItem(await deps.videoRepo.setStatus(id, "published"));
    },

    async adminArchive(id) {
      await requireAdminRow(id);
      return toAdminListItem(await deps.videoRepo.setStatus(id, "archived"));
    },

    async adminFeature(id) {
      await requireAdminRow(id);
      return toAdminListItem(await deps.videoRepo.setFeatured(id));
    },
  };
}
