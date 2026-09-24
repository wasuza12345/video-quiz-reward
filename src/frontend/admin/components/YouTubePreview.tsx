"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/frontend/shared/ui/Skeleton";
import { useAdminYouTubePreview, type AdminYTPlayer } from "../hooks/useAdminYouTubePreview";
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
  const { containerRef, player, ready, error } = useAdminYouTubePreview(youtubeId);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const reportedDuration = useRef(false);

  useEffect(() => {
    if (!ready || !player) return;
    const handle: YouTubePreviewHandle = {
      getCurrentTime: () => player.getCurrentTime(),
      getDuration: () => player.getDuration(),
      seekTo: (sec) => {
        player.seekTo(sec, true);
        player.pauseVideo();
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
