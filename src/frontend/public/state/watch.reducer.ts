// Reducer for /watch/[videoId] (plan §8, spec.md §4.4). Server `state` from every write response
// is the truth; the reducer's job is to reconcile local UI state to it. Only WatchPage owns this.
import { watch as copy } from "../constants/copy.th";
import type { PublicQuestion, SessionResponseVideo, SessionState } from "@/shared/contracts/session";
import type { ClaimResponse } from "@/shared/contracts/session";
import type { WatchAction } from "./watch.actions";

export type WatchStatus = "loading" | "ready" | "playing" | "paused" | "quiz_open" | "ended" | "claiming" | "rewarded" | "error";
export type QuizPhase = "syncing" | "ready" | "submitting" | null;
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

export interface WatchState {
  status: WatchStatus;
  loadingSlow: boolean;
  reloadingInPlace: boolean;

  totalPoints: number | null;
  pointsUnavailable: boolean;

  sessionId: string | null;
  serverState: SessionState | null;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  isReplay: boolean;
  alreadyRewarded: boolean;
  currentQuestionId: string | null;
  passedQuestionIds: string[];
  video: SessionResponseVideo | null;
  quizzes: PublicQuestion[];

  isNewSession: boolean;
  showResumedBanner: boolean;
  showReplayBanner: boolean;
  pausedByTabHidden: boolean;

  quizPhase: QuizPhase;
  pendingChoice: string | null;
  wrongChoiceLabels: string[];
  feedback: { tone: FeedbackTone; message: string } | null;

  claimResult: ClaimResponse | null;
  claimError: boolean;
  inlineNotice: "ended_fallback" | "replay_end" | null;

  toastRequest: ToastRequest | null;
  offline: boolean;
  error: WatchError | null;
  pendingSeekTo: number | null;
}

export const initialWatchState: WatchState = {
  status: "loading",
  loadingSlow: false,
  reloadingInPlace: false,
  totalPoints: null,
  pointsUnavailable: false,
  sessionId: null,
  serverState: null,
  positionSec: 0,
  furthestSec: 0,
  lastSeq: 0,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: null,
  passedQuestionIds: [],
  video: null,
  quizzes: [],
  isNewSession: true,
  showResumedBanner: false,
  showReplayBanner: false,
  pausedByTabHidden: false,
  quizPhase: null,
  pendingChoice: null,
  wrongChoiceLabels: [],
  feedback: null,
  claimResult: null,
  claimError: false,
  inlineNotice: null,
  toastRequest: null,
  offline: false,
  error: null,
  pendingSeekTo: null,
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
function initialStatusForServerState(state: SessionState): WatchStatus {
  if (state === "QUIZ_PENDING") return "quiz_open";
  if (state === "ENDED") return "claiming";
  return state === "PLAYING" ? "playing" : "ready";
}

/** Mid-session resync (SEQ_CONFLICT, gate fallback): watching has already started, so anything
 * but PLAYING/QUIZ_PENDING/ENDED means the user is paused, not back at the pre-play screen. */
function resyncStatusForServerState(state: SessionState): WatchStatus {
  if (state === "QUIZ_PENDING") return "quiz_open";
  if (state === "ENDED") return "claiming";
  return state === "PLAYING" ? "playing" : "paused";
}

export function watchReducer(state: WatchState, action: WatchAction): WatchState {
  switch (action.type) {
    case "ME_LOADED":
      return { ...state, totalPoints: action.me.totalPoints, pointsUnavailable: false };

    case "ME_FAILED":
      return { ...state, pointsUnavailable: true };

    case "SESSION_LOADED": {
      const s = action.session;
      const status = initialStatusForServerState(s.state);
      return {
        ...state,
        status,
        reloadingInPlace: false,
        sessionId: s.sessionId,
        serverState: s.state,
        positionSec: s.positionSec,
        furthestSec: s.furthestSec,
        lastSeq: s.lastSeq,
        isReplay: s.isReplay,
        alreadyRewarded: s.alreadyRewarded,
        currentQuestionId: s.currentQuestionId,
        passedQuestionIds: s.passedQuestionIds,
        video: s.video,
        quizzes: s.quizzes,
        isNewSession: s.state === "CREATED" && s.positionSec === 0,
        showResumedBanner: status === "ready" && s.positionSec > 0,
        showReplayBanner: s.isReplay || s.alreadyRewarded,
        quizPhase: status === "quiz_open" ? "ready" : null,
        wrongChoiceLabels: [],
        feedback: null,
        claimResult: null,
        claimError: false,
        inlineNotice: null,
        error: null,
      };
    }

    case "SESSION_LOAD_FAILED":
      return { ...state, status: "error", error: action.reason === "not_found" ? ERROR.videoNotFound : ERROR.sessionLoadFailed };

    case "LOADING_SLOW":
      return state.status === "loading" ? { ...state, loadingSlow: true } : state;

    case "PLAYER_ERROR":
      return { ...state, status: "error", error: ERROR.playerFailed };

    case "PLAY_CLICKED":
      if (state.status !== "ready" && state.status !== "paused") return state;
      return { ...state, status: "playing", pausedByTabHidden: false, showResumedBanner: false, showReplayBanner: false };

    case "PAUSE_CLICKED":
      if (state.status !== "playing") return state;
      return { ...state, status: "paused", pausedByTabHidden: false };

    case "TAB_HIDDEN":
      if (state.status !== "playing") return state;
      return { ...state, status: "paused", pausedByTabHidden: true };

    case "QUIZ_GATE_HIT":
      return { ...state, status: "quiz_open", quizPhase: "syncing", currentQuestionId: action.questionId };

    case "GATE_TICK_RESULT": {
      if (state.status !== "quiz_open" || state.quizPhase !== "syncing") return state; // stale response
      if (action.state === "QUIZ_PENDING") {
        return { ...state, quizPhase: "ready", serverState: action.state, positionSec: action.positionSec, furthestSec: action.furthestSec };
      }
      // Gate fallback (row 12): the gate TICK didn't land as QUIZ_PENDING — close and resync.
      return {
        ...state,
        status: resyncStatusForServerState(action.state),
        quizPhase: null,
        serverState: action.state,
        positionSec: action.positionSec,
        furthestSec: action.furthestSec,
        pendingSeekTo: action.positionSec,
        toastRequest: requestToast("resync", copy.toast.gateFallback),
      };
    }

    case "PROGRESS_REJECTED":
      return {
        ...state,
        positionSec: action.positionSec,
        furthestSec: action.furthestSec,
        pendingSeekTo: action.positionSec,
        toastRequest: action.jumpSec >= 2 ? requestToast("resync", copy.toast.resync) : state.toastRequest,
      };

    case "SEQ_CONFLICT":
      return {
        ...state,
        serverState: action.state,
        positionSec: action.positionSec,
        furthestSec: action.furthestSec,
        pendingSeekTo: action.positionSec,
        status: state.status === "quiz_open" || state.status === "error" ? state.status : resyncStatusForServerState(action.state),
        toastRequest: requestToast("resync", copy.toast.resync),
      };

    case "CLIENT_SEEK_GUARD":
      return { ...state, pendingSeekTo: action.furthestSec, toastRequest: requestToast("resync", copy.toast.resync) };

    case "SEEK_CONSUMED":
      return { ...state, pendingSeekTo: null };

    case "ANSWER_SUBMITTED":
      if (state.status !== "quiz_open" || state.quizPhase !== "ready") return state;
      return { ...state, quizPhase: "submitting", pendingChoice: action.choice, feedback: null };

    case "ANSWER_ACCEPTED": {
      if (action.result.correct) {
        return {
          ...state,
          quizPhase: "ready",
          feedback: { tone: "correct", message: copy.quizModal.correct },
          serverState: action.result.state,
          currentQuestionId: null,
          passedQuestionIds: state.currentQuestionId ? [...state.passedQuestionIds, state.currentQuestionId] : state.passedQuestionIds,
          wrongChoiceLabels: [],
          pendingChoice: null,
        };
      }
      return {
        ...state,
        quizPhase: "ready",
        feedback: { tone: "wrong", message: copy.quizModal.wrong },
        wrongChoiceLabels: state.pendingChoice ? [...state.wrongChoiceLabels, state.pendingChoice] : state.wrongChoiceLabels,
        pendingChoice: null,
      };
    }

    case "ANSWER_FAILED": {
      if (action.code === "NOT_AT_QUIZ") {
        // row 12 fallback: the session moved on without us — close the modal, resync elsewhere.
        return { ...state, status: "paused", quizPhase: null, toastRequest: requestToast("resync", copy.toast.gateFallback) };
      }
      const message = action.code === "INVALID_CHOICE" ? copy.quizModal.invalidChoice : copy.quizModal.answerFailed;
      return { ...state, quizPhase: "ready", feedback: { tone: "error", message }, pendingChoice: null };
    }

    case "QUIZ_RESUME_AFTER_CORRECT":
      if (state.status !== "quiz_open") return state;
      return { ...state, status: "paused", quizPhase: null, feedback: null };

    case "VIDEO_ENDED":
      return { ...state, status: "ended" };

    case "ENDED_ACCEPTED":
      return { ...state, status: "claiming", serverState: "ENDED", claimError: false, inlineNotice: null };

    case "ENDED_NOT_WATCHED":
      return {
        ...state,
        status: "playing",
        pendingSeekTo: action.seekTo,
        inlineNotice: "ended_fallback",
      };

    case "CLAIM_STARTED":
      return { ...state, claimError: false };

    case "CLAIM_ACCEPTED":
      return {
        ...state,
        status: "rewarded",
        claimResult: action.result,
        claimError: false,
        totalPoints: action.result.totalPoints,
        inlineNotice: action.result.awarded ? null : "replay_end",
      };

    case "CLAIM_FAILED":
      return { ...state, claimError: true };

    case "CLAIM_NOT_ENDED":
      return { ...state, status: "playing", inlineNotice: "ended_fallback" };

    case "REPLAY_REQUESTED":
      return { ...state, status: "loading", reloadingInPlace: true, error: null };

    case "RETRY_REQUESTED":
      if (state.status === "error") return { ...state, status: "loading", error: null };
      if (state.claimError) return { ...state, claimError: false };
      return state;

    case "OFFLINE":
      return { ...state, offline: true, toastRequest: requestToast("offline", copy.toast.offline) };

    case "ONLINE":
      return { ...state, offline: false };

    default:
      return state;
  }
}
