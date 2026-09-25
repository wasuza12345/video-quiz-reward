// Actions the reducer in watch.reducer.ts responds to (plan §8, spec.md §4.4).
import type { AnswerResponse, ClaimResponse, SessionCreateResponse, SessionState } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";

export type WatchAction =
  | { type: "ME_LOADED"; me: MeResponse }
  | { type: "ME_FAILED" }
  | { type: "SESSION_LOADED"; session: SessionCreateResponse }
  | { type: "SESSION_LOAD_FAILED"; reason: "not_found" | "network" }
  | { type: "LOADING_SLOW" }
  | { type: "PLAYER_ERROR" }
  | { type: "PLAY_CLICKED" }
  | { type: "PAUSE_CLICKED" }
  | { type: "TAB_HIDDEN" }
  | { type: "QUIZ_GATE_HIT"; questionId: string }
  // The write response for the gate TICK: server state tells us whether the gate really opened.
  | { type: "GATE_TICK_RESULT"; state: SessionState; positionSec: number; furthestSec: number }
  // Dispatched on every ACCEPTED events response (plan §8) — this is the only thing that ever
  // advances positionSec/furthestSec in normal (non-error) operation; without it they never move.
  | { type: "EVENTS_SYNCED"; state: SessionState; positionSec: number; furthestSec: number; currentQuestionId: string | null }
  | { type: "PROGRESS_REJECTED"; positionSec: number; furthestSec: number; jumpSec: number }
  | { type: "SEQ_CONFLICT"; state: SessionState; positionSec: number; furthestSec: number }
  | { type: "CLIENT_SEEK_GUARD"; furthestSec: number }
  | { type: "ANSWER_SUBMITTED"; choice: string }
  | { type: "ANSWER_ACCEPTED"; result: AnswerResponse }
  | { type: "ANSWER_FAILED"; code: "network" | "INVALID_CHOICE" | "NOT_AT_QUIZ" }
  | { type: "QUIZ_RESUME_AFTER_CORRECT"; hidden: boolean }
  | { type: "VIDEO_ENDED" }
  | { type: "ENDED_ACCEPTED" }
  | { type: "ENDED_NOT_WATCHED"; seekTo: number }
  | { type: "CLAIM_ACCEPTED"; result: ClaimResponse }
  | { type: "CLAIM_FAILED" }
  | { type: "CLAIM_NOT_ENDED" }
  | { type: "REPLAY_REQUESTED" }
  | { type: "RETRY_REQUESTED" }
  | { type: "OFFLINE" }
  | { type: "SEEK_CONSUMED" };
