import { Prisma } from "@/backend/lib/prisma";
import { AppError } from "@/backend/common/errors/app-error";
import type { AuditContext } from "@/backend/common/audit/audit-log";
import { fetchYoutubeOembed, parseYoutubeId } from "@/backend/lib/youtube";
import type { AdminCreateVideoBody, AdminUpdateVideoBody, AdminVideoDetail, AdminVideoListItem, Paged } from "@/shared/contracts/admin";
import type { RewardRepository } from "../reward/reward.interface";
import type { AdminQuestionRow, AdminVideoRow, AdminVideoWithQuestions, VideoRepository, VideoRow } from "./video.interface";

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

/** 0 < triggerSec < durationSec - 2 (plan §7) — re-checked whenever durationSec itself changes,
 * since a question valid under the old duration can silently become
 * unreachable under a shorter one. */
function assertQuestionsFitDuration(questions: AdminQuestionRow[], durationSec: number): void {
  for (const q of questions) {
    if (!(q.triggerSec > 0 && q.triggerSec < durationSec - 2)) {
      throw new AppError("INVALID_TRIGGER", `question at ${q.triggerSec}s no longer fits within the video's duration`, { questionId: q.id, triggerSec: q.triggerSec, durationSec });
    }
  }
}

/** Full re-validation before publish — a video must never go live with a
 * question nobody can ever reach or correctly answer, which would make canEnd impossible (plan
 * §6: the quiz gate blocks progress) or the reward unattainable. */
function assertQuestionsPublishable(questions: AdminQuestionRow[], durationSec: number): void {
  assertQuestionsFitDuration(questions, durationSec);
  for (const q of questions) {
    if (q.choices.length < 2 || q.choices.length > 4) {
      throw new AppError("VALIDATION_ERROR", "a question must have 2-4 choices", { questionId: q.id, issues: [{ path: "choices", message: "must have 2-4 choices" }] });
    }
    if (!q.choices.some((c) => c.label === q.correctChoice)) {
      throw new AppError("VALIDATION_ERROR", "correctChoice must be one of the question's choices", {
        questionId: q.id,
        issues: [{ path: "correctChoice", message: "must be one of the question's choices" }],
      });
    }
  }
}

export interface VideoService {
  listVideos(userId: string): Promise<VideoListResult>;
  adminList(page: number, pageSize: number): Promise<Paged<AdminVideoListItem>>;
  adminDetail(id: string): Promise<AdminVideoDetail>;
  adminCreate(input: AdminCreateVideoBody, admin: AuditContext): Promise<AdminVideoListItem>;
  adminUpdate(id: string, input: AdminUpdateVideoBody, admin: AuditContext): Promise<AdminVideoListItem>;
  adminPublish(id: string, admin: AuditContext): Promise<AdminVideoListItem>;
  adminArchive(id: string, admin: AuditContext): Promise<AdminVideoListItem>;
  adminFeature(id: string, admin: AuditContext): Promise<AdminVideoListItem>;
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

    async adminCreate(input, admin) {
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
        const row = await deps.videoRepo.create(
          {
            youtubeId,
            title: input.title?.trim() || oembed.title,
            channelName: oembed.channelName,
            durationSec: input.durationSec,
            rewardPoints: input.rewardPoints,
          },
          admin,
        );
        return toAdminListItem(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("VALIDATION_ERROR", "this video has already been added", { issues: [{ path: "youtubeUrl", message: "already added" }] });
        }
        throw err;
      }
    },

    async adminUpdate(id, input, admin) {
      const current = await requireAdminRow(id);
      const locked = current.sessionCount > 0;
      const touchesLockedFields = input.youtubeUrl !== undefined || input.durationSec !== undefined;
      if (locked && touchesLockedFields) {
        throw new AppError("VIDEO_LOCKED", "this video has viewers and its link/length can no longer be changed", {
          sessionCount: current.sessionCount,
        });
      }

      // A shorter duration can strand an existing question past the new gate window —
      // this can only happen when unlocked (locked already rejected durationSec above).
      if (input.durationSec !== undefined) assertQuestionsFitDuration(current.questions, input.durationSec);

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
        const row = await deps.videoRepo.update(
          id,
          { youtubeId, channelName, title: input.title, durationSec: input.durationSec, rewardPoints: input.rewardPoints },
          admin,
          touchesLockedFields,
        );
        if (!row) {
          // The atomic gate caught a session created between the check above and this write.
          throw new AppError("VIDEO_LOCKED", "this video has viewers and its link/length can no longer be changed", { sessionCount: current.sessionCount + 1 });
        }
        return toAdminListItem(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("VALIDATION_ERROR", "this video has already been added", { issues: [{ path: "youtubeUrl", message: "already added" }] });
        }
        throw err;
      }
    },

    async adminPublish(id, admin) {
      const video = await requireAdminRow(id);
      // Idempotent: re-clicking "publish" on an already-published video just returns it as-is,
      // rather than erroring or re-validating (a documented choice).
      if (video.status === "published") return toAdminListItem(video);

      assertQuestionsPublishable(video.questions, video.durationSec);
      return toAdminListItem(await deps.videoRepo.setStatus(id, "published", "video.publish", admin));
    },

    async adminArchive(id, admin) {
      await requireAdminRow(id);
      return toAdminListItem(await deps.videoRepo.setStatus(id, "archived", "video.archive", admin));
    },

    async adminFeature(id, admin) {
      const video = await requireAdminRow(id);
      if (video.status !== "published") {
        throw new AppError("INVALID_TRANSITION", "only a published video can be set as featured", { status: video.status });
      }
      return toAdminListItem(await deps.videoRepo.setFeatured(id, admin));
    },
  };
}
