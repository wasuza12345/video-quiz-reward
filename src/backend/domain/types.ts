import type { ClientEventType, EventType, RejectReason, SessionState } from "@/shared/constants/session";

/** The CAS-guarded fields of a WatchSession that the domain reads and writes. */
export interface SessionSnapshot {
  state: SessionState;
  isReplay: boolean;
  currentQuestionId: string | null;
  passedQuestionIds: string[];
  positionSec: number;
  furthestSec: number;
  playedWallSec: number;
  bankSec: number;
  lastPlayingAt: Date | null;
  softRejectCount: number;
  flagged: boolean;
  endedAt: Date | null;
}

export interface QuizGate {
  id: string;
  triggerSec: number;
}

export interface VideoRules {
  durationSec: number;
  /** Every question of the video (any order). */
  questions: QuizGate[];
}

export interface ClientEvent {
  seq: number;
  type: ClientEventType;
  positionSec: number;
}

/** One audit row (WatchEvent) produced by the domain; the service adds ids, clientAt and serverAt. */
export interface EventRecord {
  seq: number | null;
  type: EventType;
  positionSec: number;
  accepted: boolean;
  rejectReason: RejectReason | null;
  fromState: SessionState;
  toState: SessionState;
  payload?: Record<string, unknown>;
}
