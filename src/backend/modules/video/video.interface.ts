import type { VideoStatus } from "@/backend/domain/resume-policy";
import type { AuditContext } from "@/backend/common/audit/audit-log";

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

/** The admin-facing row — same facts plus what only the backoffice needs (plan §4.5). */
export interface AdminVideoRow extends VideoRow {
  publishedAt: Date | null;
  sessionCount: number;
}

export interface AdminQuestionRow {
  id: string;
  triggerSec: number;
  prompt: string;
  correctChoice: string;
  choices: { label: string; text: string }[];
}

export interface AdminVideoWithQuestions extends AdminVideoRow {
  questions: AdminQuestionRow[];
}

export interface CreateVideoInput {
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
}

/** Only the fields an admin can ever PATCH — youtubeId/durationSec may still be locked at the
 * service layer even when present here (plan §7). */
export interface UpdateVideoInput {
  youtubeId?: string;
  title?: string;
  channelName?: string;
  durationSec?: number;
  rewardPoints?: number;
}

export interface VideoRepository {
  /** Published videos only, ordered featured-first then newest. */
  listPublished(): Promise<VideoRow[]>;
  /** Any status — used by session creation, which allows continuing an archived video. */
  findById(videoId: string): Promise<VideoRow | null>;

  /** Every status, newest first (plan §5.3: the client filters by status/pageSize=100). */
  listAdmin(page: number, pageSize: number): Promise<{ items: AdminVideoRow[]; total: number }>;
  findAdminById(id: string): Promise<AdminVideoWithQuestions | null>;
  create(input: CreateVideoInput, audit: AuditContext): Promise<AdminVideoRow>;
  /**
   * `requireUnlocked`: when true (the update touches youtubeUrl/durationSec — plan §7's locked
   * set), the write is gated on a conditional `updateMany({ sessions: { none: {} } })` so a
   * session created between the service's lock check and this write can't slip through (review
   * round 2 MINOR 3) — `null` means the gate failed (now locked).
   */
  update(id: string, input: UpdateVideoInput, audit: AuditContext, requireUnlocked: boolean): Promise<AdminVideoRow | null>;
  setStatus(id: string, status: VideoStatus, action: "video.publish" | "video.archive", audit: AuditContext): Promise<AdminVideoRow>;
  /** Sets `isFeatured` on `id` and unsets it on every other video (plan §4.4: "feature unsets the others"). */
  setFeatured(id: string, audit: AuditContext): Promise<AdminVideoRow>;
}
