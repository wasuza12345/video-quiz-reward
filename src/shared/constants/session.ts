// Shared by backend domain, API contracts and the public client (plan §5, §6).

export const SESSION_STATES = ["CREATED", "PLAYING", "PAUSED", "QUIZ_PENDING", "ENDED"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** Events the client may send in POST /api/sessions/:id/events. */
export const CLIENT_EVENT_TYPES = ["PLAY", "PAUSE", "TICK", "SEEK", "TAB_HIDDEN", "ENDED"] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

/** Events the server writes itself (seq = NULL). */
export const SERVER_EVENT_TYPES = ["ANSWER", "CLAIM", "RESUME"] as const;
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

export type EventType = ClientEventType | ServerEventType;

/** Events that move position; a rejected one aborts the rest of the batch's progress events. */
export const PROGRESS_EVENT_TYPES: readonly ClientEventType[] = ["TICK", "SEEK"];

export const REJECT_REASONS = [
  "QUIZ_REQUIRED",
  "SEEK_FORWARD",
  "SPEED_EXCEEDED",
  "NOT_WATCHED",
  "INVALID_TRANSITION",
  "BATCH_ABORTED",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** Rejections that count toward `softRejectCount` (a single one can be network loss). */
export const SOFT_REJECT_REASONS: readonly RejectReason[] = ["SPEED_EXCEEDED", "NOT_WATCHED"];

export const TOLERANCES = {
  /** Max play-time credit per event (s): covers a lost PAUSE. */
  CREDIT_CAP_SEC: 10,
  /** Bank refill per credited second (allows 1.1× progress). */
  BANK_RATE: 1.1,
  BANK_INITIAL_SEC: 3,
  BANK_MAX_SEC: 6,
  /** Forward slack past furthestSec for TICK and SEEK (s). */
  FORWARD_SLACK_SEC: 1.5,
  /** canEnd: furthestSec must reach durationSec − this (s). */
  END_SLACK_SEC: 2,
  /** canEnd: playedWallSec must reach durationSec × this. */
  MIN_PLAYED_RATIO: 0.9,
  SOFT_REJECT_FLAG_AT: 3,
} as const;
