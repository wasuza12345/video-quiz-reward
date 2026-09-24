// Pure derived values from WatchState — components read these instead of re-deriving copy/flags.
import { formatTime, watch as copy } from "../constants/copy.th";
import type { WatchState } from "./watch.reducer";
import type { PublicQuestion } from "@/shared/contracts/session";

export function selectPlayButtonEnabled(state: WatchState): boolean {
  return state.status === "ready" || state.status === "playing" || state.status === "paused";
}

export function selectIsPlaying(state: WatchState): boolean {
  return state.status === "playing";
}

/** The earliest unpassed question, or null when all are passed — mirrors backend/domain
 * nextUnpassedQuestion (plan §6: the client uses the same ≥ triggerSec comparison as the server). */
export function nextUnpassedQuestion(quizzes: PublicQuestion[], passedQuestionIds: string[]): PublicQuestion | null {
  let next: PublicQuestion | null = null;
  for (const q of quizzes) {
    if (passedQuestionIds.includes(q.id)) continue;
    if (!next || q.triggerSec < next.triggerSec) next = q;
  }
  return next;
}

export function selectNextQuestion(state: WatchState) {
  return nextUnpassedQuestion(state.quizzes, state.passedQuestionIds);
}

export function selectCurrentQuestion(state: WatchState) {
  return state.quizzes.find((q) => q.id === state.currentQuestionId) ?? null;
}

export function selectStatusLineCopy(state: WatchState): string {
  switch (state.status) {
    case "loading":
      return state.loadingSlow ? copy.loading.slow : copy.loading.initial;
    case "ready":
      return state.showResumedBanner ? copy.statusLine.readyResumed : copy.statusLine.readyNew(state.quizzes.length, state.video?.rewardPoints ?? 0);
    case "playing": {
      if (state.inlineNotice === "ended_fallback") return copy.statusLine.endedFallback;
      const next = selectNextQuestion(state);
      if (next) return copy.statusLine.playingNextQuiz(formatTime(next.triggerSec));
      if (state.quizzes.length === 0) return copy.statusLine.playingNoQuizzes;
      return copy.statusLine.playingAllPassed;
    }
    case "paused":
      return state.pausedByTabHidden ? copy.statusLine.pausedTabHidden : copy.statusLine.paused;
    case "ended":
      return copy.statusLine.ended;
    case "claiming":
      return state.isReplay || state.alreadyRewarded ? copy.statusLine.claiming : copy.statusLine.claimingResumed;
    case "rewarded":
      return state.isReplay ? copy.statusLine.replayNew(state.quizzes.length) : "";
    default:
      return "";
  }
}

export function selectAriaBusy(state: WatchState): boolean {
  return state.status === "loading";
}
