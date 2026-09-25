// When a session may end and whether a claim earns points (plan §5, §6.4). Pure.
import { TOLERANCES } from "@/shared/constants/session";
import type { SessionSnapshot, VideoRules } from "./types";

const { END_SLACK_SEC, MIN_PLAYED_RATIO } = TOLERANCES;

/**
 * Every question passed AND watched to within 2 s of the end AND at least 0.9 × duration
 * of server-measured PLAYING time. Session age is not used.
 */
export function canEnd(
  s: Pick<SessionSnapshot, "passedQuestionIds" | "furthestSec" | "playedWallSec">,
  video: VideoRules,
): boolean {
  return (
    video.questions.every((q) => s.passedQuestionIds.includes(q.id)) &&
    s.furthestSec >= video.durationSec - END_SLACK_SEC &&
    s.playedWallSec >= video.durationSec * MIN_PLAYED_RATIO
  );
}

/** How much more server-measured PLAYING time canEnd's own playedWallSec check still needs —
 * not secret, since canEnd itself is public. Lets the client
 * compute a real recovery seek-back instead of guessing from its own (less reliable, credit-
 * capped) local estimate. */
export function remainingWatchSec(s: Pick<SessionSnapshot, "playedWallSec">, video: Pick<VideoRules, "durationSec">): number {
  return Math.max(0, video.durationSec * MIN_PLAYED_RATIO - s.playedWallSec);
}

export type ClaimDecision =
  | { ok: false; code: "NOT_ENDED" }
  /** Write the ledger row; a P2002 unique violation on it still means `awarded: false`. */
  | { ok: true; award: true; points: number }
  | { ok: true; award: false };

/**
 * CLAIM on an ENDED session. Replays and already-rewarded videos get `awarded: false`
 * (not an error, not flagged). The ledger's unique keys settle concurrent claims.
 */
export function decideClaim(
  s: Pick<SessionSnapshot, "state" | "isReplay">,
  alreadyRewarded: boolean,
  rewardPoints: number,
): ClaimDecision {
  if (s.state !== "ENDED") return { ok: false, code: "NOT_ENDED" };
  if (s.isReplay || alreadyRewarded) return { ok: true, award: false };
  return { ok: true, award: true, points: rewardPoints };
}
