"use client";

import { useEffect, useState } from "react";
import type { YouTubePlayerAdapter } from "../player/youtube-player-adapter";

export interface UsePlayerProgressOptions {
  player: YouTubePlayerAdapter | null;
  /** Only ticks while true (the reducer thinks we're playing) — mirrors useWatchTracker's own
   * `active` gate. The player isn't advancing in any other status, so a single read per render
   * already shows the right (frozen) value without polling. */
  active: boolean;
  /** Used before a player exists at all (initial load, the resume banner). */
  fallbackPositionSec: number;
  fallbackFurthestSec: number;
  getMaxReached: () => number;
}

export interface PlayerProgress {
  positionSec: number;
  furthestSec: number;
}

const TICK_INTERVAL_MS = 100; // ~10Hz — comfortably inside the 0.5s display-accuracy budget

/**
 * Display-only local clock for the progress bar and time label — the server-synced
 * state.positionSec only moves on a TICK flush, up to 5s stale. Nothing here changes what gets
 * sent to the server or how anti-cheat decides anything; it only reads player.currentTime()
 * and the tracker's local high-water mark for display. Callers should keep this in its own small
 * component (see LiveControlBar) so the ~10Hz re-renders stay scoped to the progress UI instead
 * of the whole watch page.
 */
export function usePlayerProgress({ player, active, fallbackPositionSec, fallbackFurthestSec, getMaxReached }: UsePlayerProgressOptions): PlayerProgress {
  // Only ever consulted while `active` (see the return logic below) — a stale snapshot from a
  // previous active stretch is simply ignored rather than proactively cleared, so this stays a
  // pure subscription-from-an-external-system effect (no synchronous setState in the effect body).
  const [live, setLive] = useState<PlayerProgress | null>(null);

  useEffect(() => {
    if (!player || !active) return;
    let rafId: number;
    let lastTickAt = 0;
    const loop = (now: number) => {
      if (now - lastTickAt >= TICK_INTERVAL_MS) {
        lastTickAt = now;
        setLive({ positionSec: player.currentTime(), furthestSec: Math.max(getMaxReached(), fallbackFurthestSec) });
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [player, active, getMaxReached, fallbackFurthestSec]);

  if (!player) return { positionSec: fallbackPositionSec, furthestSec: fallbackFurthestSec };
  if (active && live) return live;
  // Not playing (paused/quiz_open/ended/…), or playing but the first tick hasn't landed yet: a
  // direct read is already correct — the player isn't advancing on its own in the former case,
  // and this is at most one frame stale in the latter. The tracker's own high-water mark can be
  // reconciled *down* to the resumed/seeked-to position (a resume where positionSec < furthestSec,
  // or the ENDED_NOT_WATCHED seek-back) — state.furthestSec is server-authoritative and only ever
  // moves forward, so it's always a safe floor for what the watched band should show.
  return { positionSec: player.currentTime(), furthestSec: Math.max(getMaxReached(), fallbackFurthestSec) };
}
