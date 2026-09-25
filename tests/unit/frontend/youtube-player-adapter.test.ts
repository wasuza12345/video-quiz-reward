// Pure unit tests for YouTubePlayerAdapter — no React, no jsdom, just a fake YT.Player-shaped
// object. Ported from watch-page-autoplay-guard.test.tsx's guard-behavior cases (the ones that
// actually exercise the adapter's own autoplay-after-seek guard) plus the seekTo/ENDED-unstick
// quirk that used to live inline in WatchPage's pendingSeekTo effect. The autoResuming ~3s
// backstop case stays a WatchPage-level integration test — it's WatchPage's own recovery
// mechanism, not a YouTube quirk the adapter owns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubePlayerAdapter, type YouTubePlayerAdapterCallbacks } from "@/frontend/public/player/youtube-player-adapter";
import { YT_PLAYER_STATE, type YTPlayer } from "@/frontend/public/hooks/useYouTubePlayer";

class FakePlayer implements YTPlayer {
  playVideoCallCount = 0;
  pauseVideoCallCount = 0;
  seekToCalls: number[] = [];
  destroyCallCount = 0;
  setPlaybackRateCalls: number[] = [];
  private state: number = YT_PLAYER_STATE.PAUSED;
  private time = 0;

  setState(state: number, time = this.time) {
    this.state = state;
    this.time = time;
  }

  playVideo(): void {
    this.playVideoCallCount += 1;
  }
  pauseVideo(): void {
    this.pauseVideoCallCount += 1;
  }
  seekTo(seconds: number): void {
    this.seekToCalls.push(seconds);
  }
  getCurrentTime(): number {
    return this.time;
  }
  getPlayerState(): number {
    return this.state;
  }
  setPlaybackRate(rate: number): void {
    this.setPlaybackRateCalls.push(rate);
  }
  destroy(): void {
    this.destroyCallCount += 1;
  }
}

function callbacks(): YouTubePlayerAdapterCallbacks & {
  onPlay: ReturnType<typeof vi.fn<(positionSec: number) => void>>;
  onPause: ReturnType<typeof vi.fn<(positionSec: number) => void>>;
  onEnded: ReturnType<typeof vi.fn<(positionSec: number) => void>>;
} {
  return { onPlay: vi.fn(), onPause: vi.fn(), onEnded: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("YouTubePlayerAdapter — autoplay-after-seek guard", () => {
  it("a spurious PLAYING while the guard is armed is swallowed: paused back, no onPlay", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false }); // arms the guard (player wasn't ENDED, so no unstick playVideo)
    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);

    expect(player.pauseVideoCallCount, "a spurious PLAYING while armed must be paused straight back").toBe(1);
    expect(cb.onPlay, "onPlay must not fire for a spurious/swallowed PLAYING").not.toHaveBeenCalled();
  });

  it("BUFFERING while armed does not disarm the guard: a later spurious PLAYING is still swallowed", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false });
    adapter.handleStateChange(YT_PLAYER_STATE.BUFFERING); // must not disarm
    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);

    expect(player.pauseVideoCallCount, "BUFFERING must not have disarmed the guard").toBe(1);
    expect(cb.onPlay).not.toHaveBeenCalled();
  });

  it("the guard disarms on the first settled, non-BUFFERING state — ahead of the backstop timer", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false });
    player.setState(YT_PLAYER_STATE.PAUSED, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PAUSED); // settled -> disarms
    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);

    expect(player.pauseVideoCallCount, "PLAYING after a settled state must be treated as real, not swallowed").toBe(0);
    expect(cb.onPlay).toHaveBeenCalledWith(10);
  });

  it("CUED disarms the guard without emitting onPause", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false });
    adapter.handleStateChange(YT_PLAYER_STATE.CUED);
    expect(cb.onPause, "CUED is not a real pause").not.toHaveBeenCalled();

    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);
    expect(player.pauseVideoCallCount, "CUED must have disarmed the guard").toBe(0);
    expect(cb.onPlay).toHaveBeenCalledWith(10);
  });

  it("the ~5s backstop disarms a guard whose seek never produces any settling event at all", async () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false });
    await vi.advanceTimersByTimeAsync(5100);

    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);

    expect(player.pauseVideoCallCount, "the backstop must have disarmed the guard before this PLAYING arrived").toBe(0);
    expect(cb.onPlay).toHaveBeenCalledWith(10);
  });

  it("play() clears an armed guard so a later genuine play is not swallowed", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false }); // arms the guard (e.g. a non-autoplaying quiz-gate seek)
    adapter.play(); // a later, real intentional play (e.g. the quiz auto-resume)
    expect(player.playVideoCallCount).toBe(1);

    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);

    expect(player.pauseVideoCallCount, "play() must have disarmed the stale guard").toBe(0);
    expect(cb.onPlay).toHaveBeenCalledWith(10);
  });
});

describe("YouTubePlayerAdapter — seekTo / ENDED unstick", () => {
  it("resume:false on an ENDED player seeks then plays (unstick), with the guard armed so it stays visually paused", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);
    player.setState(YT_PLAYER_STATE.ENDED, 44);

    adapter.seekTo(0, { resume: false });

    expect(player.seekToCalls).toEqual([0]);
    expect(player.playVideoCallCount, "the ENDED unstick needs an explicit playVideo() right after seekTo()").toBe(1);

    // The resulting PLAYING must be swallowed, not reported — the guard was armed by resume:false.
    player.setState(YT_PLAYER_STATE.PLAYING, 0);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);
    expect(player.pauseVideoCallCount).toBe(1);
    expect(cb.onPlay).not.toHaveBeenCalled();
  });

  it("resume:false on a non-ENDED player seeks without an extra playVideo(), guard still armed", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);
    player.setState(YT_PLAYER_STATE.PAUSED, 20);

    adapter.seekTo(10, { resume: false });

    expect(player.seekToCalls).toEqual([10]);
    expect(player.playVideoCallCount, "no unstick needed when the player wasn't ENDED").toBe(0);

    player.setState(YT_PLAYER_STATE.PLAYING, 10);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);
    expect(player.pauseVideoCallCount, "the guard is still armed for this seek regardless of ENDED").toBe(1);
  });

  it("resume:true seeks and ensures playback continues, reported as a real play", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);
    player.setState(YT_PLAYER_STATE.PAUSED, 5);

    adapter.seekTo(20, { resume: true });

    expect(player.seekToCalls).toEqual([20]);
    expect(player.playVideoCallCount, "not already PLAYING after the seek, so an explicit playVideo() is needed").toBe(1);

    player.setState(YT_PLAYER_STATE.PLAYING, 20);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);
    expect(player.pauseVideoCallCount, "resume:true must never arm the guard").toBe(0);
    expect(cb.onPlay).toHaveBeenCalledWith(20);
  });

  it("resume:true skips the extra playVideo() call if the player is already PLAYING right after the seek", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);
    player.setState(YT_PLAYER_STATE.PLAYING, 5);

    adapter.seekTo(20, { resume: true });

    expect(player.playVideoCallCount, "already playing — no redundant playVideo() call").toBe(0);
  });
});

describe("YouTubePlayerAdapter — settled events, playback rate, lifecycle", () => {
  it("onPause fires with the settled position for a real PAUSED", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);
    player.setState(YT_PLAYER_STATE.PAUSED, 7.5);
    adapter.handleStateChange(YT_PLAYER_STATE.PAUSED);
    expect(cb.onPause).toHaveBeenCalledWith(7.5);
  });

  it("onEnded fires for ENDED and clears any armed guard", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false }); // arm a guard
    player.setState(YT_PLAYER_STATE.ENDED, 44);
    adapter.handleStateChange(YT_PLAYER_STATE.ENDED);
    expect(cb.onEnded).toHaveBeenCalledWith(44);

    // The guard must no longer be armed after ENDED — a later PLAYING is real.
    player.setState(YT_PLAYER_STATE.PLAYING, 0);
    adapter.handleStateChange(YT_PLAYER_STATE.PLAYING);
    expect(player.pauseVideoCallCount).toBe(0);
  });

  it("play()/pause()/currentTime() pass straight through to the raw player", () => {
    const player = new FakePlayer();
    const adapter = new YouTubePlayerAdapter(player, callbacks());
    player.setState(YT_PLAYER_STATE.PAUSED, 3);

    adapter.play();
    adapter.pause();
    expect(player.playVideoCallCount).toBe(1);
    expect(player.pauseVideoCallCount).toBe(1);
    expect(adapter.currentTime()).toBe(3);
  });

  it("handlePlaybackRateChange locks the rate to 1", () => {
    const player = new FakePlayer();
    const adapter = new YouTubePlayerAdapter(player, callbacks());
    adapter.handlePlaybackRateChange();
    expect(player.setPlaybackRateCalls).toEqual([1]);
  });

  it("destroy() tears down the raw player and clears any pending backstop timer", () => {
    const player = new FakePlayer();
    const cb = callbacks();
    const adapter = new YouTubePlayerAdapter(player, cb);

    adapter.seekTo(10, { resume: false }); // arms the backstop timer
    adapter.destroy();
    expect(player.destroyCallCount).toBe(1);

    // No crash and no late-swallow effect from the (now-cleared) backstop timer.
    vi.advanceTimersByTime(6000);
  });
});
