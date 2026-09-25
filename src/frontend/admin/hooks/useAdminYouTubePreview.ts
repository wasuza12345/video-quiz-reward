"use client";

import { useEffect, useRef, useState } from "react";
import { loadYouTubeIframeApi } from "@/frontend/public/hooks/useYouTubePlayer";
import { YT_PLAYER_STATE, type YTPlayer } from "@/frontend/public/player/youtube-player-types";

/** The admin preview needs `getDuration()` too (VideoDetailsForm auto-fills durationSec from it —
 * plan §7: "durationSec filled by the admin preview player's getDuration()"), which the public
 * player interface doesn't need. mute/unMute/isMuted back the seek-before-first-play fix in
 * YouTubePreview.tsx (a muted play-then-pause is how a never-started/ended player is coaxed into
 * rendering a real frame at the seeked time, with no audible blip). */
export interface AdminYTPlayer extends YTPlayer {
  getDuration(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
}

export interface UseAdminYouTubePreviewResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  player: AdminYTPlayer | null;
  ready: boolean;
  error: boolean;
}

/**
 * Admin preview player: normal YouTube controls (admins may seek — spec §5.4), reloaded whenever
 * `youtubeId` changes (e.g. the admin pastes a different URL). `null`/empty `youtubeId` renders
 * nothing (the "paste a link" empty state is the caller's job, per spec's state list).
 */
export function useAdminYouTubePreview(youtubeId: string | null, onStateChange?: (state: number) => void): UseAdminYouTubePreviewResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<AdminYTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Latest-callback ref (same pattern as the public useYouTubePlayer's onPlay/onPause/onEnded):
  // the real YT.Player's events are wired once at construction, so a caller's onStateChange
  // reaching the current render's closure (not a stale one) needs this indirection.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });

  useEffect(() => {
    // No synchronous setState here (react-hooks/set-state-in-effect) — a stale player/ready/error
    // from the *previous* youtubeId is cleared by that previous run's own cleanup below, not by
    // resetting at the top of this one (same pattern as the public useYouTubePlayer hook).
    if (!youtubeId || !containerRef.current) return;

    let cancelled = false;
    let instance: AdminYTPlayer | null = null;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !containerRef.current) return;
        instance = new YT.Player(containerRef.current, {
          videoId: youtubeId,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: () => {
              if (cancelled) return;
              setPlayer(instance);
              setReady(true);
            },
            onStateChange: (e) => onStateChangeRef.current?.(e.data),
            onError: () => onErrorLocal(),
            onPlaybackRateChange: () => {},
          },
        }) as unknown as AdminYTPlayer;
      })
      .catch(() => onErrorLocal());

    function onErrorLocal() {
      if (!cancelled) setError(true);
    }

    return () => {
      cancelled = true;
      instance?.destroy();
      setPlayer(null);
      setReady(false);
      setError(false);
    };
  }, [youtubeId]);

  return { containerRef, player, ready, error };
}

export { YT_PLAYER_STATE };
