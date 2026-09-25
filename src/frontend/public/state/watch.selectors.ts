// Pure derived values from WatchState — components read these instead of re-deriving copy/flags.
import { formatTime, watch as copy } from "../constants/copy.th";
import { nextUnpassedQuestion } from "@/shared/rules/quiz-gate";
import type { WatchState } from "./watch.reducer";

export function selectPlayButtonEnabled(state: WatchState): boolean {
  return state.status === "ready" || state.status === "playing" || state.status === "paused";
}

export function selectIsPlaying(state: WatchState): boolean {
  return state.status === "playing";
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
