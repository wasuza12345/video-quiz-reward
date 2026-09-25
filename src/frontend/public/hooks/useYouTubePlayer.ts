"use client";

import { useEffect, useRef, useState } from "react";
import { YouTubePlayerAdapter } from "../player/youtube-player-adapter";
import type { YTNamespace, YTPlayer } from "../player/youtube-player-types";

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<YTNamespace> | null = null;

/** Exported so the admin preview (frontend/admin/hooks/useAdminYouTubePreview.ts) shares the same
 * singleton script load instead of injecting the IFrame API twice. */
export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT) return Promise.resolve(window.YT);
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YT missing after ready callback"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("failed to load the YouTube IFrame API"));
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

export interface UseYouTubePlayerOptions {
  youtubeId: string;
  title: string;
  onPlay: (positionSec: number) => void;
  onPause: (positionSec: number) => void;
  onEnded: (positionSec: number) => void;
  onError: () => void;
}

export interface UseYouTubePlayerResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The quirk-free command surface (play/pause/seekTo/currentTime) — every consumer drives the
   * player through this, never the raw YT.Player directly. */
  player: YouTubePlayerAdapter | null;
  ready: boolean;
  error: boolean;
}

/**
 * Loads and owns one YouTube IFrame player. `playerVars` per plan §6: no native controls, no
 * keyboard, no fullscreen — our own ControlBar + click shield are the only way to drive it.
 */
export function useYouTubePlayer({ youtubeId, title, onPlay, onPause, onEnded, onError }: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const containerRef = useRef<HTMLDivElement>(null);
  // Tracks the live adapter across this effect invocation. Not a DOM query: the real YT IFrame
  // API *replaces* the target element with its <iframe> (it doesn't append one inside it), so
  // `containerRef.current.querySelector("iframe")` can never match in a real browser.
  const instanceRef = useRef<YouTubePlayerAdapter | null>(null);
  const [player, setPlayer] = useState<YouTubePlayerAdapter | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Latest-callback refs, kept current after every render (never read/written during render itself).
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!youtubeId || !containerRef.current) return;
    let cancelled = false;
    let instance: YTPlayer | null = null;
    let adapter: YouTubePlayerAdapter | null = null;

    loadYouTubeIframeApi()
      .then((YT) => {
        // Idempotency guard: never create a second player while one is already alive for this
        // effect invocation (defence in depth against any future refactor that decouples this
        // effect's cleanup from its own re-run). Tracked via a ref, not a DOM query — see the
        // comment on instanceRef above.
        if (cancelled || !containerRef.current || instanceRef.current) return;
        instance = new YT.Player(containerRef.current, {
          videoId: youtubeId,
          playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              // The IFrame API doesn't expose the iframe's `title` via playerVars (spec §4.2).
              containerRef.current?.querySelector("iframe")?.setAttribute("title", title);
              setPlayer(adapter);
              setReady(true);
            },
            onStateChange: (e) => adapter?.handleStateChange(e.data),
            onError: () => onErrorRef.current(),
            onPlaybackRateChange: () => adapter?.handlePlaybackRateChange(),
          },
        });
        adapter = new YouTubePlayerAdapter(instance, {
          onPlay: (pos) => onPlayRef.current(pos),
          onPause: (pos) => onPauseRef.current(pos),
          onEnded: (pos) => onEndedRef.current(pos),
        });
        instanceRef.current = adapter;
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      adapter?.destroy();
      instanceRef.current = null;
      setPlayer(null);
      setReady(false);
    };
  }, [youtubeId, title]);

  return { containerRef, player, ready, error };
}

export const YOUTUBE_PLAYER_TITLE_PREFIX = "วิดีโอ: ";
export function youtubePlayerTitle(videoTitle: string): string {
  return `${YOUTUBE_PLAYER_TITLE_PREFIX}${videoTitle}`;
}
