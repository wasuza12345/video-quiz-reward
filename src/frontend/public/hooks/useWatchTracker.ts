"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PublicQuestion } from "@/shared/contracts/session";
import type { WatchAction } from "../state/watch.actions";
import type { SessionWriterApi } from "./useSessionWriter";
import type { YTPlayer } from "./useYouTubePlayer";
import { WatchTracker } from "./watch-tracker-core";

export interface UseWatchTrackerOptions {
  player: YTPlayer | null;
  /** Only runs while the reducer thinks we're playing. */
  active: boolean;
  /** Identifies the current session — the tracker resets when this changes (a fresh mount, or a
   * replay reload that keeps WatchPage itself mounted). */
  sessionId: string | null;
  furthestSec: number;
  /** Non-null exactly when the reducer wants a corrective seek (rejection/conflict/gate-fallback/
   * ended-fallback/the guard's own snap-back) — the tracker is reconciled down to it. */
  pendingSeekTo: number | null;
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
  writer: SessionWriterApi;
  dispatch: React.Dispatch<WatchAction>;
}

/**
 * Drives the rAF anti-cheat loop (plan §6) and the TICK cadence (plan §4.2: produced every 1s,
 * flushed every 5s) via a `WatchTracker`. Positions are sent unrounded, straight from
 * `player.getCurrentTime()`.
 */
export interface WatchTrackerApi {
  /** True while a gate-hit PAUSE write is in flight — WatchPage's onStateChange(PAUSED) handler
   * uses this to skip the duplicate PAUSE the tracker's own player.pauseVideo() call triggers
   * (review MINOR 4). */
  isGateInFlight: () => boolean;
  /** The tracker's local high-water mark (display only — server furthestSec stays authoritative
   * for anti-cheat; see usePlayerProgress). */
  getMaxReached: () => number;
}

export function useWatchTracker({
  player,
  active,
  sessionId,
  furthestSec,
  pendingSeekTo,
  quizzes,
  passedQuestionIds,
  writer,
  dispatch,
}: UseWatchTrackerOptions): WatchTrackerApi {
  const tracker = useMemo(
    () => new WatchTracker(furthestSec),
    // initialFurthestSec is intentionally read only at creation time (it advances on every
    // accepted sync afterward; re-memoizing on it would reset the tracker's high-water mark).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  useEffect(() => {
    if (pendingSeekTo !== null) tracker.reconcile(pendingSeekTo);
  }, [pendingSeekTo, tracker]);

  const latest = useRef({ quizzes, passedQuestionIds });
  useEffect(() => {
    latest.current = { quizzes, passedQuestionIds };
  });
  // While a gate TICK+PAUSE write is in flight, stop re-deciding every frame — onFrame would
  // otherwise keep returning "gate" until passedQuestionIds catches up.
  const gateInFlight = useRef(false);

  useEffect(() => {
    if (!player || !active) return;
    let rafId: number;
    let lastTickAt = performance.now();
    let lastFrameAt = performance.now();

    const loop = () => {
      const now = performance.now();
      const frameDtSec = (now - lastFrameAt) / 1000;
      lastFrameAt = now;

      const currentTime = player.getCurrentTime();
      const { quizzes, passedQuestionIds } = latest.current;

      if (!gateInFlight.current) {
        const decision = tracker.onFrame(currentTime, frameDtSec, quizzes, passedQuestionIds);
        if (decision.kind === "seek_guard") {
          player.seekTo(decision.seekTo, true);
          dispatch({ type: "CLIENT_SEEK_GUARD", furthestSec: decision.seekTo });
        } else if (decision.kind === "gate") {
          gateInFlight.current = true;
          player.pauseVideo();
          writer.queueTick(currentTime);
          dispatch({ type: "QUIZ_GATE_HIT", questionId: decision.questionId });
          void writer.sendImmediate("PAUSE", currentTime).then((result) => {
            gateInFlight.current = false;
            if (result) dispatch({ type: "GATE_TICK_RESULT", state: result.state, positionSec: result.positionSec, furthestSec: result.furthestSec });
          });
        }
      }

      const nowTick = performance.now();
      if (nowTick - lastTickAt >= 1000) {
        lastTickAt = nowTick;
        writer.queueTick(currentTime);
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [player, active, tracker, writer, dispatch]);

  useEffect(() => {
    if (!player || !active) return;
    const interval = setInterval(() => {
      void writer.flushTicks().then((result) => {
        if (!result) return;
        const rejected = result.results.some((r) => !r.accepted);
        if (rejected) {
          const jumpSec = Math.abs(player.getCurrentTime() - result.positionSec);
          dispatch({ type: "PROGRESS_REJECTED", positionSec: result.positionSec, furthestSec: result.furthestSec, jumpSec });
        }
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [player, active, writer, dispatch]);

  return useMemo(() => ({ isGateInFlight: () => gateInFlight.current, getMaxReached: () => tracker.maxReached }), [tracker]);
}
