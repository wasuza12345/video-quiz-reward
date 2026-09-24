// Server state machine (plan §5). Pure: the service reads the session, calls these, then
// persists the returned snapshot with one CAS write and inserts the returned audit rows.
import {
  PROGRESS_EVENT_TYPES,
  SOFT_REJECT_REASONS,
  TOLERANCES,
  type ClientEventType,
  type RejectReason,
} from "@/shared/constants/session";
import { checkSeek, checkTick, creditPlayTime, quizGateAt } from "./progress-validator";
import { canEnd } from "./reward-policy";
import type { ClientEvent, EventRecord, SessionSnapshot, VideoRules } from "./types";

type Step = { session: SessionSnapshot; accepted: true } | { session: SessionSnapshot; accepted: false; reason: RejectReason };

const accept = (session: SessionSnapshot): Step => ({ session, accepted: true });

/** Rejects without moving position; counts soft rejects and sets `flagged` (§5). */
function reject(s: SessionSnapshot, reason: RejectReason): Step {
  const softRejectCount = s.softRejectCount + (SOFT_REJECT_REASONS.includes(reason) ? 1 : 0);
  const flagged = s.flagged || reason === "SEEK_FORWARD" || softRejectCount >= TOLERANCES.SOFT_REJECT_FLAG_AT;
  return { session: { ...s, softRejectCount, flagged }, accepted: false, reason };
}

const leavePlaying = (s: SessionSnapshot, state: SessionSnapshot["state"]): SessionSnapshot => ({
  ...s,
  state,
  lastPlayingAt: null,
});

function onPlay(s: SessionSnapshot, serverAt: Date): Step {
  switch (s.state) {
    case "CREATED":
    case "PAUSED":
      return accept({ ...s, state: "PLAYING", lastPlayingAt: serverAt });
    case "PLAYING":
    case "QUIZ_PENDING":
      return accept(s); // benign no-op
    default:
      return reject(s, "INVALID_TRANSITION");
  }
}

function onPause(s: SessionSnapshot): Step {
  switch (s.state) {
    case "PLAYING":
      return accept(leavePlaying(s, "PAUSED"));
    case "CREATED":
    case "PAUSED":
    case "QUIZ_PENDING":
      return accept(s); // benign no-op
    default:
      return reject(s, "INVALID_TRANSITION");
  }
}

function onTick(s: SessionSnapshot, video: VideoRules, pos: number): Step {
  switch (s.state) {
    case "PLAYING":
      break;
    case "CREATED":
    case "PAUSED":
      return accept(s); // race with a pause: recorded only, no position change
    case "QUIZ_PENDING":
      return reject(s, "QUIZ_REQUIRED");
    default:
      return reject(s, "INVALID_TRANSITION");
  }

  // (2) bucket check on the reported position, then (3) quiz gate.
  const check = checkTick(s, pos);
  if (!check.ok) return reject(s, check.reason);
  const paid = { ...s, bankSec: s.bankSec - check.cost };

  const gate = quizGateAt(video.questions, s.passedQuestionIds, pos);
  if (gate) {
    return accept({
      ...leavePlaying(paid, "QUIZ_PENDING"),
      positionSec: gate.triggerSec,
      furthestSec: Math.max(s.furthestSec, gate.triggerSec),
      currentQuestionId: gate.id,
    });
  }
  return accept({ ...paid, positionSec: pos, furthestSec: Math.max(s.furthestSec, pos) });
}

function onSeek(s: SessionSnapshot, pos: number): Step {
  if (s.state !== "PLAYING" && s.state !== "PAUSED") return reject(s, "INVALID_TRANSITION");
  const check = checkSeek(s, pos);
  if (!check.ok) return reject(s, check.reason);
  return accept({ ...s, positionSec: check.positionSec });
}

function onEnded(s: SessionSnapshot, video: VideoRules, serverAt: Date): Step {
  if (s.state !== "PLAYING" && s.state !== "PAUSED") return reject(s, "INVALID_TRANSITION");
  if (!canEnd(s, video)) return reject(s, "NOT_WATCHED");
  return accept({ ...leavePlaying(s, "ENDED"), endedAt: serverAt });
}

function applyOne(s: SessionSnapshot, video: VideoRules, e: ClientEvent, serverAt: Date): Step {
  // (1) Credit first, for every event processed while PLAYING. The credit measures server
  // wall time in PLAYING, so it is kept even when the event itself is then rejected.
  const credited = s.state === "PLAYING" ? creditPlayTime(s, serverAt) : s;
  switch (e.type) {
    case "PLAY":
      return onPlay(credited, serverAt);
    case "PAUSE":
    case "TAB_HIDDEN":
      return onPause(credited);
    case "TICK":
      return onTick(credited, video, e.positionSec);
    case "SEEK":
      return onSeek(credited, e.positionSec);
    case "ENDED":
      return onEnded(credited, video, serverAt);
  }
}

const isProgress = (type: ClientEventType) => PROGRESS_EVENT_TYPES.includes(type);

export interface BatchResult {
  session: SessionSnapshot;
  events: EventRecord[];
}

/**
 * Applies a batch of client events (already seq-checked and ordered by the service).
 * A rejected event never fails the batch; after the first rejected TICK/SEEK the remaining
 * TICK/SEEKs are rejected with BATCH_ABORTED, while other events are still processed.
 */
export function applyClientEvents(
  session: SessionSnapshot,
  video: VideoRules,
  events: ClientEvent[],
  serverAt: Date,
): BatchResult {
  let s = session;
  let progressRejected = false;
  const records: EventRecord[] = [];

  for (const e of events) {
    const fromState = s.state;
    const step: Step =
      progressRejected && isProgress(e.type) ? { session: s, accepted: false, reason: "BATCH_ABORTED" } : applyOne(s, video, e, serverAt);
    s = step.session;
    if (!step.accepted && isProgress(e.type)) progressRejected = true;
    records.push({
      seq: e.seq,
      type: e.type,
      positionSec: e.positionSec,
      accepted: step.accepted,
      rejectReason: step.accepted ? null : step.reason,
      fromState,
      toState: s.state,
    });
  }
  return { session: s, events: records };
}

export interface AnswerQuestion {
  id: string;
  correctChoice: string;
  labels: string[];
}

export type AnswerResult =
  | { ok: false; code: "NOT_AT_QUIZ" | "INVALID_CHOICE" }
  | { ok: true; correct: boolean; session: SessionSnapshot; event: EventRecord };

/**
 * ANSWER: only for the question the session is waiting on. Correct → PAUSED with the question
 * appended to passedQuestionIds (same CAS write); the client then sends PLAY. Wrong → stays.
 */
export function applyAnswer(s: SessionSnapshot, question: AnswerQuestion, choice: string): AnswerResult {
  if (s.state !== "QUIZ_PENDING" || s.currentQuestionId !== question.id) return { ok: false, code: "NOT_AT_QUIZ" };
  if (!question.labels.includes(choice)) return { ok: false, code: "INVALID_CHOICE" };

  const correct = choice === question.correctChoice;
  const next: SessionSnapshot = correct
    ? { ...s, state: "PAUSED", currentQuestionId: null, passedQuestionIds: [...s.passedQuestionIds, question.id] }
    : s;
  return {
    ok: true,
    correct,
    session: next,
    event: {
      seq: null,
      type: "ANSWER",
      positionSec: s.positionSec,
      accepted: true,
      rejectReason: null,
      fromState: s.state,
      toState: next.state,
      payload: { questionId: question.id, choice, correct },
    },
  };
}
