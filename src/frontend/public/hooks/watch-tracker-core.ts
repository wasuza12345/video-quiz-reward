// Pure per-frame anti-cheat decisions for the rAF loop (plan §6, spec.md §4.2). No timers, no
// player, no React — useWatchTracker.ts drives this with the real (or a fake) player's time.
import { nextUnpassedQuestion } from "../state/watch.selectors";
import type { PublicQuestion } from "@/shared/contracts/session";

const FORWARD_SLACK_SEC = 1.5;

export interface FrameInput {
  currentTime: number;
  furthestSec: number;
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
}

export type FrameDecision =
  | { kind: "seek_guard"; seekTo: number }
  | { kind: "gate"; questionId: string; triggerSec: number }
  | { kind: "none" };

/**
 * One frame's worth of anti-cheat checks, in order: the seek guard first (rAF: `current >
 * furthest + 1.5` → seekTo(furthest)), then the quiz gate (`current >= next.triggerSec`).
 * A frame that trips the seek guard never also opens the gate — the snap-back already handles it.
 */
export function decideFrame(input: FrameInput): FrameDecision {
  if (input.currentTime > input.furthestSec + FORWARD_SLACK_SEC) {
    return { kind: "seek_guard", seekTo: input.furthestSec };
  }
  const next = nextUnpassedQuestion(input.quizzes, input.passedQuestionIds);
  if (next && input.currentTime >= next.triggerSec) {
    return { kind: "gate", questionId: next.id, triggerSec: next.triggerSec };
  }
  return { kind: "none" };
}
