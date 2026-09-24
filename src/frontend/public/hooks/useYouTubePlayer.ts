"use client";

import { useEffect, useRef, useState } from "react";

// Minimal shape of the bits of the YouTube IFrame API this app uses — no @types/youtube dependency.
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

export const YT_PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, CUED: 5 } as const;

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId: string;
      playerVars: Record<string, number>;
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onError: () => void;
        onPlaybackRateChange: () => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
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
  onStateChange: (state: number) => void;
  onError: () => void;
}

export interface UseYouTubePlayerResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  player: YTPlayer | null;
  ready: boolean;
  error: boolean;
}

/**
 * Loads and owns one YouTube IFrame player. `playerVars` per plan §6: no native controls, no
 * keyboard, no fullscreen — our own ControlBar + click shield are the only way to drive it.
 * `onPlaybackRateChange` forces the rate back to 1× (a client-side nicety; the real guard is server-side).
 */
export function useYouTubePlayer({ youtubeId, title, onStateChange, onError }: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Latest-callback refs, kept current after every render (never read/written during render itself).
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    let instance: YTPlayer | null = null;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !containerRef.current) return;
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
              setPlayer(instance);
              setReady(true);
            },
            onStateChange: (e) => onStateChangeRef.current(e.data),
            onError: () => onErrorRef.current(),
            onPlaybackRateChange: () => instance?.setPlaybackRate(1),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      instance?.destroy();
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
