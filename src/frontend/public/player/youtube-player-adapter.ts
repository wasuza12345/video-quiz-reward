// Owns every YouTube IFrame API quirk this app has ever had to work around, so WatchPage only
// ever sees clean, settled events: onPlay(pos) / onPause(pos) / onEnded(pos). Everything that
// exists because of OUR session/business rules (ENDED recovery, hidden-tab policy, autoResuming)
// stays in WatchPage, which reacts to these events instead of raw YT state codes.
import { YT_PLAYER_STATE } from "./youtube-player-types";
import type { YTPlayer } from "./youtube-player-types";

export interface YouTubePlayerAdapterCallbacks {
  onPlay(positionSec: number): void;
  onPause(positionSec: number): void;
  onEnded(positionSec: number): void;
}

const AUTOPLAY_GUARD_BACKSTOP_MS = 5000;

/**
 * Wraps a raw YT.Player instance. Two related quirks live here:
 *
 * 1. Autoplay-after-seek: a `seekTo()` on an already-buffered, non-cued player is normally a
 *    silent no-op, but on some players/states it can trigger a spurious PLAYING on its own — no
 *    playVideo() call of ours involved. `seekTo(sec, { resume: false })` arms a guard so that if
 *    this fires, the resulting PLAYING is swallowed (paused straight back, never reported as a
 *    real play) instead of silently resuming playback the caller didn't ask for. The guard is
 *    one-shot: disarmed by the first settled (non-BUFFERING/UNSTARTED) state it sees, or by a
 *    ~5s backstop if nothing settles at all, or by any real play()/seekTo({resume:true}) call.
 *    BUFFERING/UNSTARTED must never disarm it early — real instrumentation on the quirk showed an
 *    async UNSTARTED -> BUFFERING -> UNSTARTED -> PLAYING sequence, and disarming on the
 *    intermediate ticks would let the quirk's own PLAYING slip through unswallowed.
 *
 * 2. ENDED unstick: seekTo() alone is a silent no-op once the player has reached ENDED —
 *    getCurrentTime() never moves, even seconds later. playVideo() called in the same
 *    synchronous pass right after seekTo() is what unsticks it (confirmed against real Chrome).
 *    `seekTo(sec, { resume: false })` does this automatically when the player was ENDED, with the
 *    guard armed first so the unstick's own PLAYING stays swallowed and the player stays visually
 *    paused; `seekTo(sec, { resume: true })` does the same unstick but WITHOUT arming the guard,
 *    so the resulting PLAYING is reported as a real play.
 */
export class YouTubePlayerAdapter {
  private suppressAutoplayAfterSeek = false;
  private backstopTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly player: YTPlayer,
    private readonly callbacks: YouTubePlayerAdapterCallbacks,
  ) {}

  /** A real, intentional play — never swallowed, even if a guard from an earlier seek is armed. */
  play(): void {
    this.clearGuard();
    this.player.playVideo();
  }

  pause(): void {
    this.player.pauseVideo();
  }

  currentTime(): number {
    return this.player.getCurrentTime();
  }

  /** Drops any armed guard without touching the player itself — for a caller resetting its own
   * session bookkeeping (e.g. an in-app replay reusing this same instance) where a guard armed
   * for the just-ended session must not carry over and swallow the new session's first play. */
  resetGuard(): void {
    this.clearGuard();
  }

  /** `resume: false` keeps the player visually paused after the seek (arms the guard, and if the
   * player was ENDED, unsticks it with a swallowed playVideo()). `resume: true` seeks and ensures
   * playback actually continues, reporting the result as a real play. */
  seekTo(sec: number, opts: { resume: boolean }): void {
    const wasEnded = this.player.getPlayerState() === YT_PLAYER_STATE.ENDED;
    if (opts.resume) {
      this.clearGuard();
      this.player.seekTo(sec, true);
      if (this.player.getPlayerState() !== YT_PLAYER_STATE.PLAYING) this.player.playVideo();
    } else {
      this.armGuard();
      this.player.seekTo(sec, true);
      if (wasEnded) this.player.playVideo();
    }
  }

  /** Called from the raw player's onStateChange (via the React wrapper). Translates raw YT state
   * codes into the clean onPlay/onPause/onEnded callbacks, swallowing quirks along the way. */
  handleStateChange(ytState: number): void {
    const currentTime = this.player.getCurrentTime();
    if (ytState === YT_PLAYER_STATE.PLAYING) {
      if (this.suppressAutoplayAfterSeek) {
        this.clearGuard();
        this.player.pauseVideo();
        return;
      }
      this.callbacks.onPlay(currentTime);
    } else if (ytState === YT_PLAYER_STATE.BUFFERING || ytState === YT_PLAYER_STATE.UNSTARTED) {
      // Transitional — intentionally a no-op. Disarming here would let the seek quirk's own
      // eventual PLAYING slip through unswallowed.
    } else if (ytState === YT_PLAYER_STATE.PAUSED || ytState === YT_PLAYER_STATE.CUED) {
      this.clearGuard();
      if (ytState === YT_PLAYER_STATE.CUED) return;
      this.callbacks.onPause(currentTime);
    } else if (ytState === YT_PLAYER_STATE.ENDED) {
      this.clearGuard();
      this.callbacks.onEnded(currentTime);
    }
  }

  /** Locks playback to 1× — a client-side nicety (the real guard is server-side). Called from the
   * raw player's onPlaybackRateChange. */
  handlePlaybackRateChange(): void {
    this.player.setPlaybackRate(1);
  }

  destroy(): void {
    this.clearGuard();
    this.player.destroy();
  }

  private armGuard(): void {
    this.suppressAutoplayAfterSeek = true;
    if (this.backstopTimeout !== null) clearTimeout(this.backstopTimeout);
    this.backstopTimeout = setTimeout(() => {
      this.suppressAutoplayAfterSeek = false;
      this.backstopTimeout = null;
    }, AUTOPLAY_GUARD_BACKSTOP_MS);
  }

  private clearGuard(): void {
    this.suppressAutoplayAfterSeek = false;
    if (this.backstopTimeout !== null) {
      clearTimeout(this.backstopTimeout);
      this.backstopTimeout = null;
    }
  }
}
