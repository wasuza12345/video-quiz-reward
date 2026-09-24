// Progress rules (plan §6). Pure: no IO, no clock — serverAt is passed in.
// Per event the order is fixed: (1) credit play time, (2) bucket / seek check, (3) quiz gate.
import { TOLERANCES } from "@/shared/constants/session";
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
 * `pos − furthestSec` from the bank. A jump past furthestSec + 1.5 is a forward seek.
 */
export function checkTick(s: SessionSnapshot, pos: number): TickCheck {
  if (pos <= s.furthestSec) return { ok: true, cost: 0 };
  if (pos > s.furthestSec + FORWARD_SLACK_SEC) return { ok: false, reason: "SEEK_FORWARD" };
  const need = pos - s.furthestSec;
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

/** The earliest question not yet passed, or null when all are passed. */
export function nextUnpassedQuestion(questions: QuizGate[], passedQuestionIds: string[]): QuizGate | null {
  let next: QuizGate | null = null;
  for (const q of questions) {
    if (passedQuestionIds.includes(q.id)) continue;
    if (!next || q.triggerSec < next.triggerSec) next = q;
  }
  return next;
}

/** (3) Quiz gate: the question a TICK to `pos` runs into, if any (pos is then clamped to its triggerSec). */
export function quizGateAt(questions: QuizGate[], passedQuestionIds: string[], pos: number): QuizGate | null {
  const next = nextUnpassedQuestion(questions, passedQuestionIds);
  return next && pos >= next.triggerSec ? next : null;
}
