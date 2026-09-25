// Progress rules (plan §6). Pure: no IO, no clock — serverAt is passed in.
// Per event the order is fixed: (1) credit play time, (2) bucket / seek check, (3) quiz gate.
import { TOLERANCES } from "@/shared/constants/session";
import { nextUnpassedQuestion } from "@/shared/rules/quiz-gate";
import type { QuizGate, SessionSnapshot } from "./types";

const { CREDIT_CAP_SEC, BANK_RATE, BANK_MAX_SEC, FORWARD_SLACK_SEC } = TOLERANCES;

/**
 * (1) Credit wall time spent in PLAYING since `lastPlayingAt`, capped per event.
 * Refills the bank at 1.1× the credited time (max 6 s). Leaves `lastPlayingAt = serverAt`;
 * the caller sets it to null when the event leaves PLAYING.
 * Events of one batch share `serverAt`, so only the first one credits anything.
 */
export function creditPlayTime(s: SessionSnapshot, serverAt: Date): SessionSnapshot {
  const elapsedSec = s.lastPlayingAt ? (serverAt.getTime() - s.lastPlayingAt.getTime()) / 1000 : 0;
  const delta = Math.min(Math.max(elapsedSec, 0), CREDIT_CAP_SEC);
  return {
    ...s,
    playedWallSec: s.playedWallSec + delta,
    bankSec: Math.min(s.bankSec + delta * BANK_RATE, BANK_MAX_SEC),
    lastPlayingAt: serverAt,
  };
}

export type TickCheck = { ok: true; cost: number } | { ok: false; reason: "SEEK_FORWARD" | "SPEED_EXCEEDED" };

/**
 * (2) Token bucket for a TICK. Rewatching (pos ≤ furthestSec) is free; new ground costs
 * `need = pos − furthestSec` from the bank. `need` larger than the bank can ever hold
 * (> BANK_MAX_SEC) is a forward seek; a smaller shortfall against the current bank is the
 * soft SPEED_EXCEEDED. The +1.5 s slack (FORWARD_SLACK_SEC) applies to explicit SEEK only
 * (see checkSeek) — a TICK has no slack of its own.
 */
export function checkTick(s: SessionSnapshot, pos: number): TickCheck {
  if (pos <= s.furthestSec) return { ok: true, cost: 0 };
  const need = pos - s.furthestSec;
  if (need > BANK_MAX_SEC) return { ok: false, reason: "SEEK_FORWARD" };
  if (need > s.bankSec) return { ok: false, reason: "SPEED_EXCEEDED" };
  return { ok: true, cost: need };
}

export type SeekCheck = { ok: true; positionSec: number } | { ok: false; reason: "SEEK_FORWARD" };

/**
 * SEEK: backwards and anywhere up to furthestSec is free; within the 1.5 s slack it is
 * clamped to furthestSec; beyond that it is a forward seek. Never raises furthestSec.
 */
export function checkSeek(s: SessionSnapshot, pos: number): SeekCheck {
  if (pos <= s.furthestSec) return { ok: true, positionSec: pos };
  if (pos <= s.furthestSec + FORWARD_SLACK_SEC) return { ok: true, positionSec: s.furthestSec };
  return { ok: false, reason: "SEEK_FORWARD" };
}

/** Re-exported so callers/tests importing it from here (its pre-existing home) still work. */
export { nextUnpassedQuestion };

/** (3) Quiz gate: the question a TICK to `pos` runs into, if any (pos is then clamped to its triggerSec). */
export function quizGateAt(questions: QuizGate[], passedQuestionIds: string[], pos: number): QuizGate | null {
  const next = nextUnpassedQuestion(questions, passedQuestionIds);
  return next && pos >= next.triggerSec ? next : null;
}
