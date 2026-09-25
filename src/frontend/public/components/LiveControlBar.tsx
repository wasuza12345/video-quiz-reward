"use client";

import { ControlBar } from "./ControlBar";
import { usePlayerProgress } from "../hooks/usePlayerProgress";
import type { YTPlayer } from "../hooks/useYouTubePlayer";
import type { PublicQuestion } from "@/shared/contracts/session";

export interface LiveControlBarProps {
  player: YTPlayer | null;
  active: boolean;
  fallbackPositionSec: number;
  fallbackFurthestSec: number;
  getMaxReached: () => number;
  isPlaying: boolean;
  enabled: boolean;
  onToggle: () => void;
  durationSec: number;
  quizzes: PublicQuestion[];
  passedQuestionIds: string[];
}

/**
 * Isolates the ~10Hz display-clock re-renders (usePlayerProgress) to ControlBar/WatchProgress
 * only — WatchPage itself (and everything else it renders) stays on its normal, event-driven
 * render cadence.
 */
export function LiveControlBar({ player, active, fallbackPositionSec, fallbackFurthestSec, getMaxReached, ...controlBarProps }: LiveControlBarProps) {
  const { positionSec, furthestSec } = usePlayerProgress({ player, active, fallbackPositionSec, fallbackFurthestSec, getMaxReached });
  return <ControlBar {...controlBarProps} positionSec={positionSec} furthestSec={furthestSec} />;
}
