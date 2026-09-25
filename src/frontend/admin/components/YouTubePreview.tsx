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

// Reviewer MINOR: if the muted play we force to unstick a never-played player never actually
// yields a PLAYING confirmation (autoplay blocked, or just very slow), the preview must not stay
// muted forever, and a later genuine Play must not get silently swallowed by a since-stale
// unstick. This is the patience limit before giving up and restoring on its own.
const UNSTICK_BACKSTOP_MS = 3_000;

/** admin/components/YouTubePreview (spec §5.4): normal controls, live readout, empty/loading/ready/error states. */
export function YouTubePreview({ youtubeId, onReady, onDuration, onTimeUpdate }: YouTubePreviewProps) {
  // Set by seekTo() only when the player was UNSTARTED/CUED/ENDED: those states show a black frame
  // (or the last-rendered one) after a bare seekTo — YouTube doesn't actually decode/paint a frame
  // at the new position until real playback runs. Muted play-then-pause-on-first-PLAYING coaxes a
  // real frame out with no audible blip; PLAYING/PAUSED already have a rendered frame, so they keep
  // the plain seekTo+pause.
  const unstickingRef = useRef(false);
  const wasMutedBeforeUnstickRef = useRef(false);
  const unstickBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A ref, not the `player` state variable directly: handleStateChange must exist (and be passed
  // into the hook call below) before `player` itself is declared from that same call's result, and
  // must keep reading the LATEST instance across re-renders regardless.
  const playerRef = useRef<AdminYTPlayer | null>(null);

  const clearUnstickBackstop = useCallback(() => {
    if (unstickBackstopRef.current !== null) {
      clearTimeout(unstickBackstopRef.current);
      unstickBackstopRef.current = null;
    }
  }, []);

  // Restores the mute state left over from an in-flight unstick and disarms it. Shared by the real
  // PLAYING confirmation, the backstop (autoplay blocked / never confirms), and a later seekTo
  // landing before either of those — reviewer MAJOR: a repeat "ไปที่เวลานี้" before the first
  // PLAYING used to leave the preview permanently muted two ways: (a) a 2nd click while still
  // UNSTARTED/CUED re-read isMuted() as our OWN mute (true), overwriting the real pre-unstick
  // state; (b) a 2nd click while BUFFERING took the plain seekTo+pause path and just cleared
  // unstickingRef, silently dropping the pending restore. Never touches play/pause — each caller
  // decides that for itself.
  const restoreUnstickMute = useCallback(() => {
    if (!unstickingRef.current) return;
    unstickingRef.current = false;
    clearUnstickBackstop();
    if (!wasMutedBeforeUnstickRef.current) playerRef.current?.unMute();
  }, [clearUnstickBackstop]);

  const handleStateChange = useCallback(
    (state: number) => {
      if (!unstickingRef.current || state !== YT_PLAYER_STATE.PLAYING) return;
      restoreUnstickMute();
      playerRef.current?.pauseVideo();
    },
    [restoreUnstickMute],
  );
  const { containerRef, player, ready, error } = useAdminYouTubePreview(youtubeId, handleStateChange);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const reportedDuration = useRef(false);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => clearUnstickBackstop, [clearUnstickBackstop]);

  useEffect(() => {
    if (!ready || !player) return;
    const handle: YouTubePreviewHandle = {
      getCurrentTime: () => player.getCurrentTime(),
      getDuration: () => player.getDuration(),
      seekTo: (sec) => {
        const state = player.getPlayerState();
        const needsUnstick = state === YT_PLAYER_STATE.UNSTARTED || state === YT_PLAYER_STATE.CUED || state === YT_PLAYER_STATE.ENDED;
        if (needsUnstick) {
          // Only capture the pre-unstick mute state on the FIRST attempt of a possible streak of
          // repeat clicks — re-reading isMuted() on a later one would see our own mute() (true)
          // and wrongly adopt it as "was already muted".
          if (!unstickingRef.current) wasMutedBeforeUnstickRef.current = player.isMuted();
          unstickingRef.current = true;
          player.seekTo(sec, true);
          player.mute();
          player.playVideo();
          clearUnstickBackstop();
          unstickBackstopRef.current = setTimeout(() => {
            unstickBackstopRef.current = null;
            // Our forced playVideo() above can still be genuinely pending here (a slow CUED →
            // BUFFERING transition past our patience window) — if it lands AFTER we've already
            // restored the mute below, the preview ends up audibly playing while the admin edits.
            // Pause it first, while it's still muted.
            const stuckState = playerRef.current?.getPlayerState();
            if (stuckState === YT_PLAYER_STATE.BUFFERING || stuckState === YT_PLAYER_STATE.UNSTARTED) {
              playerRef.current?.pauseVideo();
            }
            restoreUnstickMute();
          }, UNSTICK_BACKSTOP_MS);
        } else {
          // A pending unstick can still be in flight here (e.g. this 2nd seek lands while
          // BUFFERING, between the mute+playVideo above and the real PLAYING confirmation) — settle
          // it synchronously before the normal seek+pause, instead of leaving it to a PLAYING event
          // that may now never (correctly) arrive for THIS attempt.
          restoreUnstickMute();
          player.seekTo(sec, true);
          player.pauseVideo();
        }
      },
      pauseVideo: () => player.pauseVideo(),
    };
    onReady?.(handle);
  }, [ready, player, onReady, restoreUnstickMute, clearUnstickBackstop]);

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
