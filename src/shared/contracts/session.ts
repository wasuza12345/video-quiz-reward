// Public API request contracts (plan §4.1, §4.2) plus the response shapes backend services
// return, mirrored here so the frontend can type against them without importing `backend/`.
import { z } from "zod";
import { CLIENT_EVENT_TYPES, EVENT_CAPS } from "@/shared/constants/session";
import type { ClientEventType, RejectReason, SessionState } from "@/shared/constants/session";

export const clientEventSchema = z.object({
  seq: z.number().int().min(1),
  type: z.enum(CLIENT_EVENT_TYPES),
  positionSec: z.number().finite().min(0),
  clientAt: z.string().optional(),
});

export const postEventsBodySchema = z
  .object({ events: z.array(clientEventSchema).min(1).max(EVENT_CAPS.MAX_EVENTS_PER_REQUEST) })
  .refine((b) => b.events.every((e, i) => i === 0 || e.seq > b.events[i - 1].seq), {
    message: "events[].seq must be strictly increasing",
    path: ["events"],
  });
export type PostEventsBody = z.infer<typeof postEventsBodySchema>;

export const createSessionBodySchema = z.object({ videoId: z.string().min(1) });
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

export const answerBodySchema = z.object({
  questionId: z.string().min(1),
  choice: z.string().min(1),
});
export type AnswerBody = z.infer<typeof answerBodySchema>;

// ---------- responses (plan §4.1) ----------

export interface PublicChoice {
  label: string;
  text: string;
}

export interface PublicQuestion {
  id: string;
  triggerSec: number;
  prompt: string;
  choices: PublicChoice[];
}

export interface SessionResponseVideo {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
}

export interface SessionCreateResponse {
  sessionId: string;
  state: SessionState;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  isReplay: boolean;
  alreadyRewarded: boolean;
  currentQuestionId: string | null;
  passedQuestionIds: string[];
  video: SessionResponseVideo;
  quizzes: PublicQuestion[];
}

export interface EventResult {
  seq: number;
  accepted: boolean;
  rejectReason: RejectReason | null;
}

export interface EventsApplyResponse {
  state: SessionState;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  currentQuestionId: string | null;
  results: EventResult[];
}

export interface AnswerResponse {
  correct: boolean;
  state: SessionState;
}

export interface ClaimResponse {
  awarded: boolean;
  points: number;
  totalPoints: number;
}

/** `{ error: { code, message, ...extra } }` (plan §4). `extra` carries SEQ_CONFLICT's recovery fields. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    lastSeq?: number;
    state?: SessionState;
    positionSec?: number;
    furthestSec?: number;
    [key: string]: unknown;
  };
}

export type { ClientEventType, SessionState };
