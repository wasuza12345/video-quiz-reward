// Discriminated-union reducer for /watch/[videoId], replacing the flat WatchState in
// watch.reducer.ts: invalid combinations (e.g. status "playing" with a quiz-only field set) can't
// be represented. Same WatchAction inputs and observable outcomes as watch.reducer.ts; consumed
// through the selectors in watch.selectors.ts.
//
// Scope note: the plan's Phase union also lists a quiz step "resuming" for the ~900ms
// auto-resume-after-correct-answer window. That window is still owned by WatchPage's own
// `autoResuming` useState + backstop timer, not by this reducer — absorbing it (a new
// RESUME_TIMEOUT action, a machine-owned backstop) is #12b, a separate follow-up commit, so left
// out of QuizStep entirely here rather than declared-but-unused dead code.
import { watch as copy } from "../constants/copy.th";
import type { ClaimResponse, PublicQuestion, SessionResponseVideo, SessionState } from "@/shared/contracts/session";
import type { WatchAction } from "./watch.actions";

export type QuizStep = "syncing" | "answering" | "submitting" | "correct";
export type FeedbackTone = "wrong" | "correct" | "error";

export interface ToastRequest {
  id: number;
  key: string;
  message: string;
}

export interface WatchError {
  title: string;
  body: string;
  action: string;
  secondaryAction?: string;
}

export interface SessionSnapshot {
  id: string;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  isReplay: boolean;
  alreadyRewarded: boolean;
  passedQuestionIds: string[];
  video: SessionResponseVideo;
  quizzes: PublicQuestion[];
}

export type Phase =
  | { kind: "loading"; slow: boolean; reloadingInPlace: boolean }
  | { kind: "error"; error: WatchError }
  | { kind: "ready"; resumedAtSec: number | null }
  | { kind: "playing"; endedFallback: boolean }
  | { kind: "paused"; reason: "user" | "tab_hidden" }
  | {
      kind: "quiz";
      questionId: string;
      step: QuizStep;
      pendingChoice: string | null;
      wrongChoices: string[];
      feedback: { tone: FeedbackTone; message: string } | null;
    }
  | { kind: "ending" }
  | { kind: "claiming"; failed: boolean }
  | { kind: "rewarded"; result: ClaimResponse; replayEnd: boolean };

export interface WatchState {
  phase: Phase;
  session: SessionSnapshot | null;
  points: { total: number | null; unavailable: boolean };
  // freshSession: true only for the seek that follows a brand-new SESSION_LOADED (a real reload or
  // an in-app replay). WatchPage's seek effect uses it to reset any stale autoplay guard from the
  // just-ended previous session right before issuing this seek — a single call doing reset-then-arm
  // atomically, instead of a separate effect racing the seek on declaration order. See
  // watch-page-fresh-session-seek.test.tsx.
  seekRequest: { toSec: number; resume: boolean; freshSession: boolean } | null;
  toast: ToastRequest | null;
  showReplayBanner: boolean;
}

export const initialWatchState: WatchState = {
  phase: { kind: "loading", slow: false, reloadingInPlace: false },
  session: null,
  points: { total: null, unavailable: false },
  seekRequest: null,
  toast: null,
  showReplayBanner: false,
};

let toastCounter = 0;
function requestToast(key: string, message: string): ToastRequest {
  toastCounter += 1;
  return { id: toastCounter, key, message };
}

const ERROR = {
  videoNotFound: { ...copy.error.videoNotFound },
  sessionLoadFailed: { ...copy.error.sessionLoadFailed },
  playerFailed: { ...copy.error.playerFailed },
  eventLimit: { ...copy.error.eventLimit },
  notOwner: { ...copy.error.notOwner },
  validation: { ...copy.error.validation },
} satisfies Record<string, WatchError>;

export { ERROR as WATCH_ERRORS };

/** SESSION_LOADED only: before the first PLAY, CREATED/PAUSED are both the pre-play "ready" screen. */
function initialPhaseForServerState(s: SessionState, positionSec: number, questionId: string | null): Phase {
  if (s === "QUIZ_PENDING" && questionId) {
    return { kind: "quiz", questionId, step: "answering", pendingChoice: null, wrongChoices: [], feedback: null };
  }
  if (s === "ENDED") return { kind: "claiming", failed: false };
  if (s === "PLAYING") return { kind: "playing", endedFallback: false };
  return { kind: "ready", resumedAtSec: positionSec > 0 ? positionSec : null };
}

/** Mid-session resync (SEQ_CONFLICT, gate fallback): watching has already started, so anything
 * but PLAYING/QUIZ_PENDING/ENDED means the user is paused, not back at the pre-play screen. */
function resyncPhaseForServerState(s: SessionState, questionId: string | null): Phase {
  if (s === "QUIZ_PENDING" && questionId) {
    return { kind: "quiz", questionId, step: "answering", pendingChoice: null, wrongChoices: [], feedback: null };
  }
  if (s === "ENDED") return { kind: "claiming", failed: false };
  if (s === "PLAYING") return { kind: "playing", endedFallback: false };
  return { kind: "paused", reason: "user" };
}

export function watchMachine(state: WatchState, action: WatchAction): WatchState {
  switch (action.type) {
    case "ME_LOADED":
      return { ...state, points: { total: action.me.totalPoints, unavailable: false } };

    case "ME_FAILED":
      return { ...state, points: { ...state.points, unavailable: true } };

    case "SESSION_LOADED": {
      const s = action.session;
      const phase = initialPhaseForServerState(s.state, s.positionSec, s.currentQuestionId);
      return {
        ...state,
        phase,
        session: {
          id: s.sessionId,
          positionSec: s.positionSec,
          furthestSec: s.furthestSec,
          lastSeq: s.lastSeq,
          isReplay: s.isReplay,
          alreadyRewarded: s.alreadyRewarded,
          passedQuestionIds: s.passedQuestionIds,
          video: s.video,
          quizzes: s.quizzes,
        },
        showReplayBanner: s.isReplay || s.alreadyRewarded,
        // Always seek, even to 0 — an in-app replay reuses the same player instance, still
        // sitting at ENDED, so an explicit seekTo(0) is what unsticks Play.
        seekRequest: { toSec: s.positionSec, resume: phase.kind === "playing", freshSession: true },
      };
    }

    case "SESSION_LOAD_FAILED":
      return { ...state, phase: { kind: "error", error: action.reason === "not_found" ? ERROR.videoNotFound : ERROR.sessionLoadFailed } };

    case "LOADING_SLOW":
      return state.phase.kind === "loading" ? { ...state, phase: { ...state.phase, slow: true } } : state;

    case "PLAYER_ERROR":
      return { ...state, phase: { kind: "error", error: ERROR.playerFailed } };

    case "PLAY_CLICKED":
      if (state.phase.kind !== "ready" && state.phase.kind !== "paused") return state;
      return { ...state, phase: { kind: "playing", endedFallback: false }, showReplayBanner: false };

    case "PAUSE_CLICKED":
      if (state.phase.kind !== "playing") return state;
      return { ...state, phase: { kind: "paused", reason: "user" } };

    case "TAB_HIDDEN":
      if (state.phase.kind !== "playing") return state;
      return { ...state, phase: { kind: "paused", reason: "tab_hidden" } };

    case "QUIZ_GATE_HIT":
      return { ...state, phase: { kind: "quiz", questionId: action.questionId, step: "syncing", pendingChoice: null, wrongChoices: [], feedback: null } };

    case "GATE_TICK_RESULT": {
      if (state.phase.kind !== "quiz" || state.phase.step !== "syncing" || !state.session) return state; // stale response
      const withPosition = { ...state, session: { ...state.session, positionSec: action.positionSec, furthestSec: action.furthestSec } };
      if (action.state === "QUIZ_PENDING") {
        return { ...withPosition, phase: { ...state.phase, step: "answering" } };
      }
      // Gate fallback (row 12): the gate TICK didn't land as QUIZ_PENDING — close and resync.
      return {
        ...withPosition,
        phase: resyncPhaseForServerState(action.state, null),
        seekRequest: { toSec: action.positionSec, resume: action.state === "PLAYING", freshSession: false },
        toast: requestToast("resync", copy.toast.gateFallback),
      };
    }

    case "EVENTS_SYNCED": {
      if (!state.session) return state;
      const session = { ...state.session, positionSec: action.positionSec, furthestSec: action.furthestSec };
      // The server can reach QUIZ_PENDING via an ordinary TICK flush too (not only the dedicated
      // gate-hit TICK+PAUSE) — if we're still showing "playing" when that happens, open the quiz.
      if (action.state === "QUIZ_PENDING" && state.phase.kind === "playing" && action.currentQuestionId) {
        return {
          ...state,
          session,
          phase: { kind: "quiz", questionId: action.currentQuestionId, step: "answering", pendingChoice: null, wrongChoices: [], feedback: null },
        };
      }
      return { ...state, session };
    }

    case "PROGRESS_REJECTED": {
      if (!state.session) return state;
      return {
        ...state,
        session: { ...state.session, positionSec: action.positionSec, furthestSec: action.furthestSec },
        seekRequest: { toSec: action.positionSec, resume: state.phase.kind === "playing", freshSession: false },
        toast: action.jumpSec >= 2 ? requestToast("resync", copy.toast.resync) : state.toast,
      };
    }

    case "SEQ_CONFLICT": {
      if (!state.session) return state;
      const session = { ...state.session, positionSec: action.positionSec, furthestSec: action.furthestSec };
      const phase = state.phase.kind === "quiz" || state.phase.kind === "error" ? state.phase : resyncPhaseForServerState(action.state, null);
      return {
        ...state,
        session,
        phase,
        seekRequest: { toSec: action.positionSec, resume: phase.kind === "playing", freshSession: false },
        toast: requestToast("resync", copy.toast.resync),
      };
    }

    case "CLIENT_SEEK_GUARD":
      return { ...state, seekRequest: { toSec: action.furthestSec, resume: state.phase.kind === "playing", freshSession: false }, toast: requestToast("resync", copy.toast.resync) };

    case "SEEK_CONSUMED":
      return { ...state, seekRequest: null };

    case "ANSWER_SUBMITTED":
      if (state.phase.kind !== "quiz" || state.phase.step !== "answering") return state;
      return { ...state, phase: { ...state.phase, step: "submitting", pendingChoice: action.choice, feedback: null } };

    case "ANSWER_ACCEPTED": {
      if (state.phase.kind !== "quiz" || !state.session) return state;
      const quizPhase = state.phase;
      if (action.result.correct) {
        return {
          ...state,
          session: { ...state.session, passedQuestionIds: [...state.session.passedQuestionIds, quizPhase.questionId] },
          phase: { ...quizPhase, step: "correct", feedback: { tone: "correct", message: copy.quizModal.correct }, wrongChoices: [], pendingChoice: null },
        };
      }
      return {
        ...state,
        phase: {
          ...quizPhase,
          step: "answering",
          feedback: { tone: "wrong", message: copy.quizModal.wrong },
          wrongChoices: quizPhase.pendingChoice ? [...quizPhase.wrongChoices, quizPhase.pendingChoice] : quizPhase.wrongChoices,
          pendingChoice: null,
        },
      };
    }

    case "ANSWER_FAILED": {
      if (state.phase.kind !== "quiz") return state;
      if (action.code === "NOT_AT_QUIZ") {
        // row 12 fallback: the session moved on without us — close the modal, resync elsewhere.
        return { ...state, phase: { kind: "paused", reason: "user" }, toast: requestToast("resync", copy.toast.gateFallback) };
      }
      const message = action.code === "INVALID_CHOICE" ? copy.quizModal.invalidChoice : copy.quizModal.answerFailed;
      return { ...state, phase: { ...state.phase, step: "answering", feedback: { tone: "error", message }, pendingChoice: null } };
    }

    case "QUIZ_RESUME_AFTER_CORRECT":
      if (state.phase.kind !== "quiz") return state;
      return { ...state, phase: { kind: "paused", reason: action.hidden ? "tab_hidden" : "user" } };

    case "VIDEO_ENDED":
      return { ...state, phase: { kind: "ending" } };

    case "ENDED_ACCEPTED":
      return { ...state, phase: { kind: "claiming", failed: false } };

    case "ENDED_NOT_WATCHED":
      return {
        ...state,
        phase: { kind: "playing", endedFallback: true },
        seekRequest: { toSec: action.seekTo, resume: true, freshSession: false },
      };

    case "CLAIM_ACCEPTED":
      return {
        ...state,
        phase: { kind: "rewarded", result: action.result, replayEnd: !action.result.awarded },
        points: { ...state.points, total: action.result.totalPoints },
      };

    case "CLAIM_FAILED":
      return state.phase.kind === "claiming" ? { ...state, phase: { ...state.phase, failed: true } } : state;

    case "CLAIM_NOT_ENDED":
      return { ...state, phase: { kind: "playing", endedFallback: true } };

    case "REPLAY_REQUESTED":
      return { ...state, phase: { kind: "loading", slow: false, reloadingInPlace: true } };

    case "RETRY_REQUESTED":
      if (state.phase.kind === "error") return { ...state, phase: { kind: "loading", slow: false, reloadingInPlace: false } };
      if (state.phase.kind === "claiming" && state.phase.failed) return { ...state, phase: { ...state.phase, failed: false } };
      return state;

    case "OFFLINE":
      return { ...state, toast: requestToast("offline", copy.toast.offline) };

    default:
      return state;
  }
}
