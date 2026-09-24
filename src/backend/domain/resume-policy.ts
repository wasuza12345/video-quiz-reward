// Which session POST /api/sessions resumes or creates (plan §4.3). Pure.
import type { SessionState } from "@/shared/constants/session";
import type { EventRecord, SessionSnapshot } from "./types";

export type VideoStatus = "draft" | "published" | "archived";

export interface ExistingSession {
  id: string;
  isReplay: boolean;
  state: SessionState;
  startedAt: Date;
  /** A PointsLedger row exists for this session. */
  rewarded: boolean;
}

export type ResumeDecision =
  | { action: "resume"; sessionId: string }
  | { action: "create"; isReplay: boolean }
  | { action: "not_found" };

/**
 * @param sessions this user's sessions for this video (any order)
 * @param videoRewarded this user already has a ledger row for this video
 */
export function decideResume(
  videoStatus: VideoStatus,
  sessions: ExistingSession[],
  videoRewarded: boolean,
): ResumeDecision {
  if (videoStatus === "draft") return { action: "not_found" };

  // Rule 1: a rewarded session is never resumed.
  const newestFirst = sessions.filter((s) => !s.rewarded).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  let candidate: ExistingSession | undefined;
  if (!videoRewarded) {
    // Rule 2: newest session in any state (ENDED → the client auto-claims).
    candidate = newestFirst[0];
  } else {
    // Rule 3: newest replay session, unless it has ENDED.
    const newestReplay = newestFirst.find((s) => s.isReplay);
    candidate = newestReplay && newestReplay.state !== "ENDED" ? newestReplay : undefined;
  }

  if (candidate) return { action: "resume", sessionId: candidate.id };
  // Rule 5: an archived video lets started sessions continue but starts no new ones.
  if (videoStatus === "archived") return { action: "not_found" };
  return { action: "create", isReplay: videoRewarded };
}

/**
 * Rule 4: a resumed PLAYING session becomes PAUSED without credit (the gap since the last
 * event is not trusted). Returns the RESUME audit row only when the state changed.
 */
export function applyResume(s: SessionSnapshot): { session: SessionSnapshot; event: EventRecord | null } {
  if (s.state !== "PLAYING") return { session: s, event: null };
  return {
    session: { ...s, state: "PAUSED", lastPlayingAt: null },
    event: {
      seq: null,
      type: "RESUME",
      positionSec: s.positionSec,
      accepted: true,
      rejectReason: null,
      fromState: "PLAYING",
      toState: "PAUSED",
    },
  };
}
