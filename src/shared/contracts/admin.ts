// Admin API contracts (plan §4.4/§4.5).
import { z } from "zod";
import type { VideoStatus } from "@/shared/constants/video";

// ---------- videos ----------

export const adminCreateVideoBodySchema = z.object({
  youtubeUrl: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  durationSec: z.number().finite().positive(),
  rewardPoints: z.number().int().min(1).max(1000),
});
export type AdminCreateVideoBody = z.infer<typeof adminCreateVideoBodySchema>;

export const adminUpdateVideoBodySchema = z.object({
  youtubeUrl: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
  durationSec: z.number().finite().positive().optional(),
  rewardPoints: z.number().int().min(1).max(1000).optional(),
});
export type AdminUpdateVideoBody = z.infer<typeof adminUpdateVideoBodySchema>;

export interface AdminVideoListItem {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
  status: VideoStatus;
  isFeatured: boolean;
  publishedAt: string | null;
  questionCount: number;
  sessionCount: number;
  locked: boolean;
}

export interface AdminQuestionDetail {
  id: string;
  triggerSec: number;
  prompt: string;
  correctChoice: string;
  choices: { label: string; text: string }[];
}

export interface AdminVideoDetail extends AdminVideoListItem {
  questions: AdminQuestionDetail[];
}

// ---------- quiz questions ----------

const choiceLabelSchema = z.enum(["A", "B", "C", "D"]);
const choiceInputSchema = z.object({ label: choiceLabelSchema, text: z.string().min(1).max(200) });

export const adminCreateQuestionBodySchema = z.object({
  triggerSec: z.number().finite().positive(),
  prompt: z.string().min(1).max(300),
  choices: z.array(choiceInputSchema).min(2).max(4),
  correctChoice: choiceLabelSchema,
});
export type AdminCreateQuestionBody = z.infer<typeof adminCreateQuestionBodySchema>;

export const adminUpdateQuestionBodySchema = z.object({
  triggerSec: z.number().finite().positive().optional(),
  prompt: z.string().min(1).max(300).optional(),
  choices: z.array(choiceInputSchema).min(2).max(4).optional(),
  correctChoice: choiceLabelSchema.optional(),
});
export type AdminUpdateQuestionBody = z.infer<typeof adminUpdateQuestionBodySchema>;

// ---------- paging ----------

export const pagingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PagingQuery = z.infer<typeof pagingQuerySchema>;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------- users ----------

export interface AdminUserListItem {
  id: string;
  createdAt: string;
  totalPoints: number;
  sessionCount: number;
  lastActiveAt: string | null;
}

export interface AdminUserLedgerRow {
  sessionId: string;
  videoId: string;
  videoTitle: string;
  points: number;
  createdAt: string;
}

export interface AdminUserDetail {
  user: { id: string; createdAt: string; totalPoints: number };
  ledger: AdminUserLedgerRow[];
  sessions: SessionRow[];
}

// ---------- sessions ----------

export interface SessionRow {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  state: string;
  flagged: boolean;
  isReplay: boolean;
  furthestSec: number;
  durationSec: number;
  playedWallSec: number;
  pointsAwarded: number;
  startedAt: string;
  endedAt: string | null;
}

export const adminSessionsQuerySchema = pagingQuerySchema.extend({
  videoId: z.string().min(1).optional(),
  flagged: z.coerce.boolean().optional(),
});
export type AdminSessionsQuery = z.infer<typeof adminSessionsQuerySchema>;

export interface AdminSessionEventRow {
  id: number;
  seq: number | null;
  type: string;
  positionSec: number;
  clientAt: string | null;
  serverAt: string;
  accepted: boolean;
  rejectReason: string | null;
  fromState: string;
  toState: string;
  payload: string | null;
}

export interface AdminSessionDetail {
  session: SessionRow & {
    positionSec: number;
    bankSec: number;
    softRejectCount: number;
    passedQuestionIds: string[];
    currentQuestionId: string | null;
    questionCount: number;
    lastSeq: number;
    version: number;
    eventCount: number;
  };
  events: AdminSessionEventRow[];
}

// ---------- stats ----------

export interface AdminStats {
  views: number;
  completions: number;
  pointsAwarded: number;
  flaggedSessions: number;
}

export const adminStatsQuerySchema = z.object({ videoId: z.string().min(1).optional() });
