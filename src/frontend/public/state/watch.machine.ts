// Discriminated-union reducer for /watch/[videoId], replacing the flat WatchState in
// watch.reducer.ts: invalid combinations (e.g. status "playing" with a quiz-only field set) can't
// be represented. Same WatchAction inputs as watch.reducer.ts; observable outcomes are the same
// EXCEPT for the deliberate changes below, consumed through the selectors in watch.selectors.ts:
//
//  1. SEQ_CONFLICT landing on QUIZ_PENDING with no questionId (a server/client desync) used to
//     stick status at "quiz_open" with the modal never rendering (currentQuestionId stayed null)
//     — now correctly resyncs to "paused" instead. See "no stuck state" in watch.machine.test.ts.
//  2. SESSION_LOADED with server state QUIZ_PENDING but a null currentQuestionId used to stick the
//     same way — now lands on "ready" instead.
//  3. EVENTS_SYNCED reaching QUIZ_PENDING with a null currentQuestionId used to be unreachable
//     (quizzes can't gate without a question id) but had no defensive check — now explicitly stays
//     "playing" instead of risking the same stuck modal.
//  4. Out-of-phase ANSWER_ACCEPTED/ANSWER_FAILED/CLAIM_FAILED (a stale network response arriving
//     after the user already left that phase) are now no-ops — the old flat reducer had no phase
//     guard on these and would silently write into fields (quizPhase, claimError, ...) the UI
//     wasn't showing anymore, a latent desync waiting for the user to re-enter that phase.
//  5. seekRequest.resume is now decided at reducer/dispatch time (baked into the action) instead
//     of read from state when WatchPage's seek effect runs. Only matters for actions the reducer
//     applies as a same-tick batch, where the old effect-time read could see a LATER action in the
//     batch's outcome that a dispatch-time bake can't — no observed real-world case, but named
//     here since it's a genuine (if narrow) behavioral difference.
//
// #12b: the ~900ms auto-resume-after-correct-answer window is a top-level Phase ("resuming"), not
// a QuizStep — the quiz modal has already closed (QUIZ_RESUME_AFTER_CORRECT always leaves "quiz")
// by the time it starts, matching what was visibly true even before this window moved into the
// machine. A QuizStep "resuming" was considered instead but rejected: keeping phase.kind "quiz"
// through the resume attempt would reopen the modal (`open` derives from phase.kind === "quiz"),
// and the 900ms timer's own re-arm guard (phase.kind==="quiz" && feedback.tone==="correct") would
// keep matching after the step changed, re-triggering the timer forever.
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
  | { kind: "loading"; slow: boolean }
  | { kind: "error"; error: WatchError }
  | { kind: "ready"; resumedAtSec: number | null }
  | { kind: "playing" }
  | { kind: "paused"; reason: "user" | "tab_hidden" }
  // The ~900ms window between a correct answer's modal closing and playback actually resuming —
  // player.play() has been issued but hasn't yet been confirmed by a real PLAYING (or timed out
  // via RESUME_TIMEOUT). selectPlayButtonEnabled excludes it, matching the old autoResuming flag
  // disabling the toggle for this same window.
  | { kind: "resuming" }
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
  | { kind: "rewarded"; result: ClaimResponse };

export interface WatchState {
  phase: Phase;
  session: SessionSnapshot | null;
  points: { total: number | null; unavailable: boolean };
  seekRequest: { toSec: number; resume: boolean } | null;
  toast: ToastRequest | null;
  showReplayBanner: boolean;
  // Lives outside Phase (unlike a quiz/claiming/rewarded-only field) because it must survive a
  // pause/resume untouched — matching the old flat WatchState's inlineNotice, which PLAY_CLICKED/
  // PAUSE_CLICKED never touched. Only ENDED_NOT_WATCHED/CLAIM_NOT_ENDED, ENDED_ACCEPTED,
  // CLAIM_ACCEPTED and a fresh SESSION_LOADED ever change it.
  inlineNotice: "ended_fallback" | "replay_end" | null;
  // Also lives outside the "loading" phase (rather than as a field on it) because it must survive
  // that phase itself ending in an error — REPLAY_REQUESTED sets it, and if the replay's own
  // SESSION_LOADED fails, SESSION_LOAD_FAILED moves phase to "error" without clearing it, so a
  // RETRY_REQUESTED back to "loading" still knows this is an in-place reload and WatchPage's
  // isLoading check keeps suppressing the skeleton — matching the old flat reducer, where
  // RETRY_REQUESTED never touched this field either.
  reloadingInPlace: boolean;
}

export const initialWatchState: WatchState = {
  phase: { kind: "loading", slow: false },
  session: null,
  points: { total: null, unavailable: false },
  seekRequest: null,
  toast: null,
  showReplayBanner: false,
  inlineNotice: null,
  reloadingInPlace: false,
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
  if (s === "PLAYING") return { kind: "playing" };
  return { kind: "ready", resumedAtSec: positionSec > 0 ? positionSec : null };
}

/** Mid-session resync (SEQ_CONFLICT, gate fallback): watching has already started, so anything
 * but PLAYING/QUIZ_PENDING/ENDED means the user is paused, not back at the pre-play screen.
 * `pausedReason` carries forward whatever reason the CURRENT phase was already paused for (if
 * any) — matching the old flat reducer, where pausedByTabHidden was a field these actions never
 * touched at all, so "paused because the tab was hidden" survived a resync untouched instead of
 * being reset to "user". */
function resyncPhaseForServerState(s: SessionState, questionId: string | null, pausedReason: "user" | "tab_hidden" = "user"): Phase {
  if (s === "QUIZ_PENDING" && questionId) {
    return { kind: "quiz", questionId, step: "answering", pendingChoice: null, wrongChoices: [], feedback: null };
  }
  if (s === "ENDED") return { kind: "claiming", failed: false };
  if (s === "PLAYING") return { kind: "playing" };
  return { kind: "paused", reason: pausedReason };
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
        inlineNotice: null,
        reloadingInPlace: false,
        // Always seek, even to 0 — an in-app replay reuses the same player instance, still
        // sitting at ENDED, so an explicit seekTo(0) is what unsticks Play.
        seekRequest: { toSec: s.positionSec, resume: phase.kind === "playing" },
      };
    }

    case "SESSION_LOAD_FAILED":
      return { ...state, phase: { kind: "error", error: action.reason === "not_found" ? ERROR.videoNotFound : ERROR.sessionLoadFailed } };

    case "LOADING_SLOW":
      return state.phase.kind === "loading" ? { ...state, phase: { ...state.phase, slow: true } } : state;

    case "PLAYER_ERROR":
      return { ...state, phase: { kind: "error", error: ERROR.playerFailed } };

    case "PLAY_CLICKED":
      // "resuming" included: a genuine PLAYING confirmation during the auto-resume window
      // completes the transition to "playing" (the common case — the whole point of the resume).
      if (state.phase.kind !== "ready" && state.phase.kind !== "paused" && state.phase.kind !== "resuming") return state;
      return { ...state, phase: { kind: "playing" }, showReplayBanner: false };

    case "PAUSE_CLICKED":
      // "resuming" included: a PAUSED confirmation arriving during the auto-resume window (e.g. a
      // stray pause landing before the resume's own play() settles) must still land on "paused",
      // not stay stuck "resuming" with a disabled toggle and no way out but the 3s backstop.
      if (state.phase.kind !== "playing" && state.phase.kind !== "resuming") return state;
      return { ...state, phase: { kind: "paused", reason: "user" } };

    case "TAB_HIDDEN":
      // "resuming" included: the tab backgrounding during the auto-resume window is exactly the
      // hidden-tab edge onPlayRef's own hidden check exists for — this is the reducer's half of
      // that (dropping the disabled-toggle "resuming" phase instead of leaving it stuck).
      if (state.phase.kind !== "playing" && state.phase.kind !== "resuming") return state;
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
      // Reached only from "quiz" (the guard above), which never carries a paused reason to
      // preserve, so this always resyncs to "paused" with reason "user" when it lands there.
      return {
        ...withPosition,
        phase: resyncPhaseForServerState(action.state, null),
        seekRequest: { toSec: action.positionSec, resume: action.state === "PLAYING" },
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
        seekRequest: { toSec: action.positionSec, resume: state.phase.kind === "playing" },
        toast: action.jumpSec >= 2 ? requestToast("resync", copy.toast.resync) : state.toast,
      };
    }

    case "SEQ_CONFLICT": {
      if (!state.session) return state;
      const session = { ...state.session, positionSec: action.positionSec, furthestSec: action.furthestSec };
      const pausedReason = state.phase.kind === "paused" ? state.phase.reason : "user";
      const phase =
        state.phase.kind === "quiz" || state.phase.kind === "error" ? state.phase : resyncPhaseForServerState(action.state, null, pausedReason);
      return {
        ...state,
        session,
        phase,
        seekRequest: { toSec: action.positionSec, resume: phase.kind === "playing" },
        toast: requestToast("resync", copy.toast.resync),
      };
    }

    case "CLIENT_SEEK_GUARD":
      return { ...state, seekRequest: { toSec: action.furthestSec, resume: state.phase.kind === "playing" }, toast: requestToast("resync", copy.toast.resync) };

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
      // A hidden tab never gets rAF ticks, so attempting the resume would silently start real
      // playback (and TICKs) the user can't see or stop — land straight on "paused" (tagged
      // tab_hidden so the "you left the tab" notice shows), never "resuming".
      if (action.hidden) return { ...state, phase: { kind: "paused", reason: "tab_hidden" } };
      return { ...state, phase: { kind: "resuming" } };

    case "RESUME_TIMEOUT":
      // Backstops "resuming": if playVideo() never yields a PLAYING confirmation at all — e.g.
      // iOS/Safari silently blocking playback that lacks a user gesture — the toggle would stay
      // disabled forever with no way for the user to recover otherwise.
      return state.phase.kind === "resuming" ? { ...state, phase: { kind: "paused", reason: "user" } } : state;

    case "VIDEO_ENDED":
      return { ...state, phase: { kind: "ending" } };

    case "ENDED_ACCEPTED":
      return { ...state, phase: { kind: "claiming", failed: false }, inlineNotice: null };

    case "ENDED_NOT_WATCHED":
      return {
        ...state,
        phase: { kind: "playing" },
        seekRequest: { toSec: action.seekTo, resume: true },
        inlineNotice: "ended_fallback",
      };

    case "CLAIM_ACCEPTED":
      return {
        ...state,
        phase: { kind: "rewarded", result: action.result },
        points: { ...state.points, total: action.result.totalPoints },
        inlineNotice: action.result.awarded ? null : "replay_end",
      };

    case "CLAIM_FAILED":
      return state.phase.kind === "claiming" ? { ...state, phase: { ...state.phase, failed: true } } : state;

    case "CLAIM_NOT_ENDED":
      return { ...state, phase: { kind: "playing" }, inlineNotice: "ended_fallback" };

    case "REPLAY_REQUESTED":
      return { ...state, phase: { kind: "loading", slow: false }, reloadingInPlace: true };

    case "RETRY_REQUESTED":
      // reloadingInPlace is untouched here (spread from state), matching the old flat reducer's
      // reloadingInPlace field, which RETRY_REQUESTED never touched either: a retry after a
      // failed in-app replay (REPLAY_REQUESTED set it true, then SESSION_LOAD_FAILED landed on
      // "error" without clearing it) must not show the loading skeleton the isLoading check in
      // WatchPage.tsx exists specifically to suppress for an in-place reload.
      if (state.phase.kind === "error") return { ...state, phase: { kind: "loading", slow: false } };
      if (state.phase.kind === "claiming" && state.phase.failed) return { ...state, phase: { ...state.phase, failed: false } };
      return state;

    case "OFFLINE":
      return { ...state, toast: requestToast("offline", copy.toast.offline) };

    default:
      return state;
  }
}
