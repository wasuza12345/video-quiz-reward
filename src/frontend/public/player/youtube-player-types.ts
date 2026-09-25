// Minimal shape of the bits of the YouTube IFrame API this app uses — no @types/youtube dependency.
// Lives here (not in hooks/useYouTubePlayer.ts) so the adapter can depend on it without a
// hooks/ <-> player/ circular import; the hook re-exports these for its existing consumers.
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

export const YT_PLAYER_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface YTNamespace {
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
