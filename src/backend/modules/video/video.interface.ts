import type { VideoStatus } from "@/backend/domain/resume-policy";

/** Internal row shape read by the repository; not the public response shape (see video.service.ts). */
export interface VideoRow {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
  status: VideoStatus;
  isFeatured: boolean;
  questionCount: number;
}

export interface VideoRepository {
  /** Published videos only, ordered featured-first then newest. */
  listPublished(): Promise<VideoRow[]>;
  /** Any status — used by session creation, which allows continuing an archived video. */
  findById(videoId: string): Promise<VideoRow | null>;
}
