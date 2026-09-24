import type { RewardRepository } from "../reward/reward.interface";
import type { VideoRepository, VideoRow } from "./video.interface";

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

export interface VideoService {
  listVideos(userId: string): Promise<VideoListResult>;
}

export function createVideoService(deps: { videoRepo: VideoRepository; rewardRepo: RewardRepository }): VideoService {
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
  };
}
