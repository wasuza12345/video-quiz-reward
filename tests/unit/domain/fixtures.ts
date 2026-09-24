import type { ClientEvent, SessionSnapshot, VideoRules } from "@/backend/domain/types";
import type { ClientEventType } from "@/shared/constants/session";

export const T0 = new Date("2026-09-24T00:00:00.000Z");
/** T0 + sec seconds. */
export const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

/** The brief video: 44 s, one question at 0:13. */
export const VIDEO: VideoRules = { durationSec: 44, questions: [{ id: "q1", triggerSec: 13 }] };
export const NO_QUIZ: VideoRules = { durationSec: 44, questions: [] };

export function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    state: "CREATED",
    isReplay: false,
    currentQuestionId: null,
    passedQuestionIds: [],
    positionSec: 0,
    furthestSec: 0,
    playedWallSec: 0,
    bankSec: 3,
    lastPlayingAt: null,
    softRejectCount: 0,
    flagged: false,
    endedAt: null,
    ...overrides,
  };
}

/** A PLAYING session whose last credit was at T0. */
export const playing = (overrides: Partial<SessionSnapshot> = {}) =>
  session({ state: "PLAYING", lastPlayingAt: T0, ...overrides });

let seq = 0;
export const ev = (type: ClientEventType, positionSec = 0): ClientEvent => ({ seq: ++seq, type, positionSec });
