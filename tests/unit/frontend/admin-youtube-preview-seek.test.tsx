// @vitest-environment jsdom
//
// Human's local check on /admin/videos/[id]: clicking "ไปที่เวลานี้" (QuizEditor.tsx's goToTime, via
// this component's seekTo handle) before the preview has ever been played turned the frame fully
// black. The time label updated (the seek "happened"), but no frame rendered.
//
// Root cause: seekTo(sec, true) followed immediately by pauseVideo() on a player that's still
// UNSTARTED/CUED (never played) or ENDED doesn't actually decode/paint a frame at the new position
// — YouTube only does that once real playback runs. Fix: for those three states, seek then mute +
// playVideo (a real play, so a frame renders), and once the first PLAYING confirmation lands,
// pauseVideo + restore the prior mute state — no audible blip. PLAYING/PAUSED already have a
// rendered frame, so they keep the original plain seekTo+pause.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";
import { YouTubePreview, type YouTubePreviewHandle } from "@/frontend/admin/components/YouTubePreview";

const YOUTUBE_ID = "X7K_Xlz3T1Y";

let nextInitialState: number = YT_PLAYER_STATE.UNSTARTED;

/** A fake of the real YT.Player surface this component actually calls. `simulatePlaying()` is the
 * test's own hand on the "a real play has actually started" confirmation — the real IFrame API
 * fires this asynchronously, well after playVideo() returns, which is exactly why the component
 * can't just pause synchronously after calling it. */
class FakeAdminPlayer {
  static instances: FakeAdminPlayer[] = [];

  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private state: number;
  private muted = false;
  seekToCalls: number[] = [];
  playVideoCallCount = 0;
  pauseVideoCallCount = 0;
  muteCallCount = 0;
  unMuteCallCount = 0;

  constructor(_container: HTMLElement, opts: { events: typeof FakeAdminPlayer.prototype.events }) {
    this.events = opts.events;
    this.state = nextInitialState;
    FakeAdminPlayer.instances.push(this);
    queueMicrotask(() => this.events.onReady());
  }

  seekTo(seconds: number) {
    this.seekToCalls.push(seconds);
  }
  playVideo() {
    this.playVideoCallCount += 1;
  }
  pauseVideo() {
    this.pauseVideoCallCount += 1;
    this.state = YT_PLAYER_STATE.PAUSED;
  }
  mute() {
    this.muteCallCount += 1;
    this.muted = true;
  }
  unMute() {
    this.unMuteCallCount += 1;
    this.muted = false;
  }
  isMuted() {
    return this.muted;
  }
  /** Test-only: seeds "was already muted before the app ever touched it", independent of mute(). */
  presetMuted(value: boolean) {
    this.muted = value;
  }
  getPlayerState() {
    return this.state;
  }
  getCurrentTime() {
    return 0;
  }
  getDuration() {
    return 79;
  }
  setPlaybackRate() {}
  destroy() {}

  simulatePlaying() {
    this.state = YT_PLAYER_STATE.PLAYING;
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  /** Test-only: the natural mid-transition state between playVideo() and a real PLAYING
   * confirmation — no event fires for this one in real YouTube either. */
  simulateBuffering() {
    this.state = YT_PLAYER_STATE.BUFFERING;
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { YT: unknown }).YT = { Player: FakeAdminPlayer };
  FakeAdminPlayer.instances = [];
  nextInitialState = YT_PLAYER_STATE.UNSTARTED;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { YT?: unknown }).YT;
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderAndGetHandle(): Promise<{ handle: YouTubePreviewHandle; player: FakeAdminPlayer }> {
  let handle: YouTubePreviewHandle | null = null;
  act(() =>
    root.render(
      <YouTubePreview
        youtubeId={YOUTUBE_ID}
        onReady={(h) => {
          handle = h;
        }}
      />,
    ),
  );
  await flush();
  await flush();
  if (!handle) throw new Error("onReady never fired");
  return { handle, player: FakeAdminPlayer.instances[0] };
}

describe.each([
  ["UNSTARTED", YT_PLAYER_STATE.UNSTARTED],
  ["CUED", YT_PLAYER_STATE.CUED],
  ["ENDED", YT_PLAYER_STATE.ENDED],
])("YouTubePreview.seekTo: player state %s (never rendered a frame at the current position)", (_label, state) => {
  it("seeks, mutes, plays to force a real frame, then pauses and unmutes once PLAYING actually lands", async () => {
    nextInitialState = state;
    const { handle, player } = await renderAndGetHandle();

    handle.seekTo(10);

    expect(player.seekToCalls, "must seek to the target time").toEqual([10]);
    expect(player.muteCallCount, "must mute before forcing a real play").toBe(1);
    expect(player.playVideoCallCount, "must actually play to coax a real frame out").toBe(1);
    expect(player.pauseVideoCallCount, "must not pause yet — only once PLAYING actually lands").toBe(0);
    expect(player.unMuteCallCount, "must not restore mute yet either").toBe(0);

    act(() => player.simulatePlaying());
    await flush();

    expect(player.pauseVideoCallCount, "must pause once the real PLAYING confirmation lands").toBe(1);
    expect(player.unMuteCallCount, "must restore the (unmuted) prior state").toBe(1);
  });

  it("does not unmute afterward if the player was already muted beforehand", async () => {
    nextInitialState = state;
    const { handle, player } = await renderAndGetHandle();
    player.presetMuted(true);

    handle.seekTo(10);
    act(() => player.simulatePlaying());
    await flush();

    expect(player.pauseVideoCallCount, "must still pause").toBe(1);
    expect(player.unMuteCallCount, "must not unmute — it was already muted before this seek").toBe(0);
    expect(player.isMuted(), "must remain muted, matching the prior state").toBe(true);
  });
});

describe.each([
  ["PLAYING", YT_PLAYER_STATE.PLAYING],
  ["PAUSED", YT_PLAYER_STATE.PAUSED],
])("YouTubePreview.seekTo: player state %s (already has a rendered frame)", (_label, state) => {
  it("just seeks and pauses — no mute/play round trip", async () => {
    nextInitialState = state;
    const { handle, player } = await renderAndGetHandle();

    handle.seekTo(10);

    expect(player.seekToCalls, "must seek to the target time").toEqual([10]);
    expect(player.pauseVideoCallCount, "must pause immediately").toBe(1);
    expect(player.playVideoCallCount, "must not force a play — a frame is already showing").toBe(0);
    expect(player.muteCallCount, "must not mute").toBe(0);
    expect(player.unMuteCallCount, "must not unmute").toBe(0);
  });
});

// Reviewer MAJOR (round 2 on this branch): a repeat "ไปที่เวลานี้" before the first PLAYING used
// to leave the preview permanently muted, two different ways. Both must fail on 9347a02.
describe("YouTubePreview.seekTo: a repeat click before the unstick resolves", () => {
  it("a 2nd seekTo while still UNSTARTED/CUED (PLAYING still hasn't landed) does not adopt our own mute() as the pre-existing mute state", async () => {
    nextInitialState = YT_PLAYER_STATE.UNSTARTED;
    const { handle, player } = await renderAndGetHandle();

    handle.seekTo(5);
    expect(player.isMuted(), "sanity: the first click must have muted it").toBe(true);

    // Still UNSTARTED — the real PLAYING confirmation from the first click's playVideo() hasn't
    // arrived yet. A bug here re-reads isMuted() (now true, from OUR OWN mute call) as "was
    // already muted", which then skips the eventual unMute() forever.
    handle.seekTo(10);

    act(() => player.simulatePlaying());
    await flush();

    expect(player.pauseVideoCallCount, "must pause once PLAYING actually lands").toBe(1);
    expect(player.unMuteCallCount, "must restore — the preview was never muted before either click").toBe(1);
    expect(player.isMuted(), "must end up unmuted").toBe(false);
    expect(player.seekToCalls.at(-1), "must have sought to the latest target").toBe(10);
  });

  it("a 2nd seekTo while BUFFERING (mid-unstick, not yet PLAYING) restores the mute synchronously instead of silently dropping it", async () => {
    nextInitialState = YT_PLAYER_STATE.UNSTARTED;
    const { handle, player } = await renderAndGetHandle();

    handle.seekTo(5);
    expect(player.muteCallCount, "sanity: the first click must have muted it").toBe(1);

    player.simulateBuffering(); // the natural mid-transition state; no PLAYING yet
    handle.seekTo(10); // takes the "plain" path — BUFFERING isn't one of the unstick states

    expect(player.unMuteCallCount, "must restore the mute synchronously, right here — not silently drop it").toBe(1);
    expect(player.isMuted(), "must end up unmuted").toBe(false);
    expect(player.seekToCalls.at(-1), "must have sought to the latest target").toBe(10);
    expect(player.pauseVideoCallCount, "must pause via the normal plain-path pause").toBeGreaterThanOrEqual(1);

    // A late PLAYING confirmation from the ORIGINAL playVideo() call, if it ever arrives, must be a
    // no-op now — this unstick attempt was already resolved by the 2nd seek above.
    const pauseCountBefore = player.pauseVideoCallCount;
    const unmuteCountBefore = player.unMuteCallCount;
    act(() => player.simulatePlaying());
    await flush();
    expect(player.pauseVideoCallCount, "a late PLAYING from the resolved attempt must not double-pause").toBe(pauseCountBefore);
    expect(player.unMuteCallCount, "must not double-unmute").toBe(unmuteCountBefore);
  });
});

// Reviewer MINOR: if the muted play never yields PLAYING at all (autoplay blocked), the unstick
// must not stay armed forever — it must not leave the preview muted, and it must not swallow a
// later, genuinely user-driven Play. Must fail on 9347a02 (no backstop existed at all).
describe("YouTubePreview.seekTo: PLAYING never arrives", () => {
  it("the ~3s backstop restores the mute and disarms; a later real Play isn't paused", async () => {
    nextInitialState = YT_PLAYER_STATE.UNSTARTED;
    const { handle, player } = await renderAndGetHandle();

    handle.seekTo(10);
    expect(player.isMuted(), "sanity: muted to force the play").toBe(true);
    expect(player.unMuteCallCount, "must not have restored yet — well under the backstop's patience").toBe(0);

    await wait(3_100); // past the ~3s backstop; PLAYING (autoplay blocked) never arrived

    expect(player.unMuteCallCount, "the backstop must restore the mute on its own").toBe(1);
    expect(player.isMuted(), "must end up unmuted").toBe(false);

    // A later, genuinely user-driven Play must not be treated as this (already-resolved) unstick's
    // own confirmation and get silently paused.
    const pauseCountBefore = player.pauseVideoCallCount;
    act(() => player.simulatePlaying());
    await flush();
    expect(player.pauseVideoCallCount, "a later real Play must not be swallowed").toBe(pauseCountBefore);
  });
});
