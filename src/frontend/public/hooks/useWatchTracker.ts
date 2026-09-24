"use client";

import { useEffect, useRef } from "react";
import type { PublicQuestion } from "@/shared/contracts/session";
import type { WatchAction } from "../state/watch.actions";
import type { SessionWriterApi } from "./useSessionWriter";
import type { YTPlayer } from "./useYouTubePlayer";
import { decideFrame } from "./watch-tracker-core";

export interface UseWatchTrackerOptions {
  player: YTPlayer | null;
  /** Only runs while the reducer thinks we're playing. */
  active: boolean;
  furthestSec: number;
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
  writer: SessionWriterApi;
  dispatch: React.Dispatch<WatchAction>;
}

/**
 * Drives the rAF anti-cheat loop (plan §6) and the TICK cadence (plan §4.2: produced every 1s,
 * flushed every 5s). Positions are sent unrounded, straight from `player.getCurrentTime()`.
 */
export function useWatchTracker({ player, active, furthestSec, quizzes, passedQuestionIds, writer, dispatch }: UseWatchTrackerOptions): void {
  const latest = useRef({ furthestSec, quizzes, passedQuestionIds });
  useEffect(() => {
    latest.current = { furthestSec, quizzes, passedQuestionIds };
  });
  // While a gate TICK+PAUSE write is in flight, stop re-deciding every frame — decideFrame would
  // otherwise keep returning "gate" until passedQuestionIds catches up.
  const gateInFlight = useRef(false);

  useEffect(() => {
    if (!player || !active) return;
    let rafId: number;
    let lastTickAt = performance.now();

    const loop = () => {
      const currentTime = player.getCurrentTime();
      const { furthestSec, quizzes, passedQuestionIds } = latest.current;

      if (!gateInFlight.current) {
        const decision = decideFrame({ currentTime, furthestSec, quizzes, passedQuestionIds });
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

      const now = performance.now();
      if (now - lastTickAt >= 1000) {
        lastTickAt = now;
        writer.queueTick(currentTime);
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [player, active, writer, dispatch]);

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
}
