"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { useAdminYouTubePreview, YT_PLAYER_STATE, type AdminYTPlayer } from "../hooks/useAdminYouTubePreview";
import { formatTime, youtubePreview as copy } from "../constants/copy.th";
import { formatMmSsTenths } from "../lib/time";

export interface YouTubePreviewHandle {
  getCurrentTime: () => number | null;
  getDuration: () => number | null;
  seekTo: (sec: number) => void;
  pauseVideo: () => void;
}

export interface YouTubePreviewProps {
  youtubeId: string | null;
  onReady?: (handle: YouTubePreviewHandle) => void;
  onDuration?: (durationSec: number) => void;
  /** Fired on the same 200ms poll as the live readout — lets a caller (the quiz editor's "ใช้
   * เวลาปัจจุบัน" button) know once playback has actually advanced past 0. */
  onTimeUpdate?: (currentTime: number) => void;
}

/** admin/components/YouTubePreview (spec §5.4): normal controls, live readout, empty/loading/ready/error states. */
export function YouTubePreview({ youtubeId, onReady, onDuration, onTimeUpdate }: YouTubePreviewProps) {
  // Set by seekTo() only when the player was UNSTARTED/CUED/ENDED: those states show a black frame
  // (or the last-rendered one) after a bare seekTo — YouTube doesn't actually decode/paint a frame
  // at the new position until real playback runs. Muted play-then-pause-on-first-PLAYING coaxes a
  // real frame out with no audible blip; PLAYING/PAUSED already have a rendered frame, so they keep
  // the plain seekTo+pause.
  const unstickingRef = useRef(false);
  const wasMutedBeforeUnstickRef = useRef(false);
  // A ref, not the `player` state variable directly: handleStateChange must exist (and be passed
  // into the hook call below) before `player` itself is declared from that same call's result, and
  // must keep reading the LATEST instance across re-renders regardless.
  const playerRef = useRef<AdminYTPlayer | null>(null);

  const handleStateChange = useCallback((state: number) => {
    if (!unstickingRef.current || state !== YT_PLAYER_STATE.PLAYING) return;
    unstickingRef.current = false;
    playerRef.current?.pauseVideo();
    if (!wasMutedBeforeUnstickRef.current) playerRef.current?.unMute();
  }, []);
  const { containerRef, player, ready, error } = useAdminYouTubePreview(youtubeId, handleStateChange);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const reportedDuration = useRef(false);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    if (!ready || !player) return;
    const handle: YouTubePreviewHandle = {
      getCurrentTime: () => player.getCurrentTime(),
      getDuration: () => player.getDuration(),
      seekTo: (sec) => {
        const state = player.getPlayerState();
        const needsUnstick = state === YT_PLAYER_STATE.UNSTARTED || state === YT_PLAYER_STATE.CUED || state === YT_PLAYER_STATE.ENDED;
        unstickingRef.current = needsUnstick;
        player.seekTo(sec, true);
        if (needsUnstick) {
          wasMutedBeforeUnstickRef.current = player.isMuted();
          player.mute();
          player.playVideo();
        } else {
          player.pauseVideo();
        }
      },
      pauseVideo: () => player.pauseVideo(),
    };
    onReady?.(handle);
  }, [ready, player, onReady]);

  useEffect(() => {
    if (!ready || !player) return;
    reportedDuration.current = false;
    const id = window.setInterval(() => {
      const t = player.getCurrentTime();
      setCurrentTime(t);
      onTimeUpdate?.(t);
      const d = player.getDuration();
      if (d > 0) {
        setDuration(d);
        if (!reportedDuration.current) {
          reportedDuration.current = true;
          onDuration?.(d);
        }
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [ready, player, onDuration, onTimeUpdate]);

  if (!youtubeId) {
    return (
      <div style={{ aspectRatio: "16/9", borderRadius: 14, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center" }}>
        <p style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{copy.empty}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ aspectRatio: "16/9", borderRadius: 14, background: "var(--danger-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center" }}>
        <p style={{ color: "var(--danger)", fontSize: "var(--fs-sm)" }}>{copy.error}</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: 14, overflow: "hidden", background: "#000" }}>
        {!ready && <Skeleton height="100%" radius={0} />}
        <div ref={containerRef} className="yt-player-container" style={{ position: "absolute", inset: 0 }} />
      </div>
      {ready && (
        <p className="tabular-nums" aria-live="off" style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", margin: "8px 0 0" }}>
          {copy.currentTime(formatMmSsTenths(currentTime), formatTime(duration))}
        </p>
      )}
    </div>
  );
}

export type { AdminYTPlayer };
