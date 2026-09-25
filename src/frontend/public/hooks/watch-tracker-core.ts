// The rAF anti-cheat seek guard + quiz gate (plan §6, spec.md §4.2), as a plain class with no
// React/player dependency — so it can be unit-tested directly (rendering/effects live in
// useWatchTracker.ts, following the same split as session-writer-core.ts/useSessionWriter.ts).
//
// The seek guard compares against a LOCAL high-water mark this class owns, NOT the reducer's
// server-synced furthestSec — that only moves on a ~5s flush cadence, so comparing against it
// directly snaps honest playback back every ~1.5s after every sync. Worse, prior to the
// EVENTS_SYNCED fix in the reducer (now watch.machine.ts), accepted responses were never
// dispatched anywhere at all, so furthestSec could stay at its initial value (often 0) for an
// entire session — every
// honest viewer hit the guard every ~1.5s, forever. `reconcile()` is the only thing that ever
// lowers this class's high-water mark; call it on a corrective server response (rejection,
// conflict, gate fallback, ended fallback) — a normal accepted sync never should.
import { nextUnpassedQuestion } from "@/shared/rules/quiz-gate";
import type { PublicQuestion } from "@/shared/contracts/session";

/** How far past the high-water mark a single frame may advance it before it's just "not yet trusted". */
const ADVANCE_FLOOR_SEC = 0.25;
/** Multiplied by the real time since the last frame, so a throttled rAF (backgrounding, a
 * rebuffer catch-up) doesn't itself look like a forward skip. */
const ADVANCE_RATE = 2;
/** Beyond this past the high-water mark, a jump is treated as a real skip and snapped back. */
const SEEK_GUARD_SLACK_SEC = 1.5;

export type FrameDecision =
  | { kind: "seek_guard"; seekTo: number }
  | { kind: "gate"; questionId: string; triggerSec: number }
  | { kind: "none" };

export class WatchTracker {
  private maxReachedSec: number;

  constructor(initialFurthestSec: number) {
    this.maxReachedSec = initialFurthestSec;
  }

  get maxReached(): number {
    return this.maxReachedSec;
  }

  /**
   * One frame's worth of anti-cheat checks. The quiz gate check always uses the raw
   * `currentTime`, independent of whether this frame's advance was accepted — queuing the gate
   * TICK is itself subject to the server's own bucket check, so this isn't a security-relevant
   * shortcut. A backward SEEK (rewatching) never lowers the high-water mark by itself.
   */
  onFrame(currentTime: number, frameDtSec: number, quizzes: PublicQuestion[], passedQuestionIds: string[]): FrameDecision {
    const advanceThreshold = Math.max(ADVANCE_FLOOR_SEC, ADVANCE_RATE * frameDtSec);

    if (currentTime <= this.maxReachedSec + advanceThreshold) {
      this.maxReachedSec = Math.max(this.maxReachedSec, currentTime);
    } else if (currentTime > this.maxReachedSec + SEEK_GUARD_SLACK_SEC) {
      return { kind: "seek_guard", seekTo: this.maxReachedSec };
    }
    // else: between advanceThreshold and the 1.5s slack — not yet trusted as new ground, but not
    // extreme enough to snap back either; the high-water mark is simply left as-is this frame.

    const next = nextUnpassedQuestion(quizzes, passedQuestionIds);
    if (next && currentTime >= next.triggerSec) {
      return { kind: "gate", questionId: next.id, triggerSec: next.triggerSec };
    }
    return { kind: "none" };
  }

  /** Forces the high-water mark down to match a corrective server response. */
  reconcile(serverFurthestSec: number): void {
    this.maxReachedSec = serverFurthestSec;
  }

  /**
   * Call whenever the player reports a real, settled position we can trust outright: a genuine
   * PAUSED state, or the next genuine (non-swallowed) PLAYING after a resume. YouTube's own
   * getCurrentTime() at the PAUSED event is itself STALE — the ~0.27s creep past the click isn't
   * visible yet there; it only shows up at the NEXT PLAYING read, once the player actually
   * resumes (confirmed against real YouTube, not just the IFrame API docs — see
   * watch-page-pause-resume-drift.test.tsx). Calling this from both places means whichever one
   * reports the drift first raises the mark; without the PLAYING call, a pause/resume with no
   * intervening onFrame() tick would leave the mark stuck exactly at the stale PAUSED position,
   * landing every frame since in onFrame's "not yet trusted" middle band forever. Bounded by
   * SEEK_GUARD_SLACK_SEC so a devtools seek can't use either call to lift the mark past what the
   * seek guard would otherwise catch.
   */
  noteSettled(currentTime: number): void {
    if (currentTime > this.maxReachedSec && currentTime - this.maxReachedSec <= SEEK_GUARD_SLACK_SEC) {
      this.maxReachedSec = currentTime;
    }
  }
}
