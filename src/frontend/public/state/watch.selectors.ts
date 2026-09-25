// Pure derived values from WatchState — components read these instead of re-deriving copy/flags.
import { formatTime, watch as copy } from "../constants/copy.th";
import { nextUnpassedQuestion } from "@/shared/rules/quiz-gate";
import type { WatchState } from "./watch.machine";

export function selectPlayButtonEnabled(state: WatchState): boolean {
  return state.phase.kind === "ready" || state.phase.kind === "playing" || state.phase.kind === "paused";
}

export function selectIsPlaying(state: WatchState): boolean {
  return state.phase.kind === "playing";
}

export function selectNextQuestion(state: WatchState) {
  return nextUnpassedQuestion(state.session?.quizzes ?? [], state.session?.passedQuestionIds ?? []);
}

export function selectCurrentQuestion(state: WatchState) {
  const phase = state.phase;
  if (phase.kind !== "quiz" || !state.session) return null;
  return state.session.quizzes.find((q) => q.id === phase.questionId) ?? null;
}

export function selectStatusLineCopy(state: WatchState): string {
  const phase = state.phase;
  switch (phase.kind) {
    case "loading":
      return phase.slow ? copy.loading.slow : copy.loading.initial;
    case "ready":
      return phase.resumedAtSec !== null ? copy.statusLine.readyResumed : copy.statusLine.readyNew(state.session?.quizzes.length ?? 0, state.session?.video.rewardPoints ?? 0);
    case "playing": {
      if (phase.endedFallback) return copy.statusLine.endedFallback;
      const next = selectNextQuestion(state);
      if (next) return copy.statusLine.playingNextQuiz(formatTime(next.triggerSec));
      if ((state.session?.quizzes.length ?? 0) === 0) return copy.statusLine.playingNoQuizzes;
      return copy.statusLine.playingAllPassed;
    }
    case "paused":
      return phase.reason === "tab_hidden" ? copy.statusLine.pausedTabHidden : copy.statusLine.paused;
    case "ending":
      return copy.statusLine.ended;
    case "claiming":
      return state.session?.isReplay || state.session?.alreadyRewarded ? copy.statusLine.claiming : copy.statusLine.claimingResumed;
    case "rewarded":
      return state.session?.isReplay ? copy.statusLine.replayNew(state.session.quizzes.length) : "";
    default:
      return "";
  }
}
