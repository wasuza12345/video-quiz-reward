// @vitest-environment jsdom
//
// Pins the invariant that replaces the old resetGuard()-vs-pendingSeekTo effect-order test: a
// fresh session's own seek (state.seekRequest.freshSession, set on SESSION_LOADED) must still
// swallow a spurious autoplay-after-seek PLAYING, even though the PREVIOUS session on this same
// player instance already left the guard armed (its own seekTo(x, {resume:false})). WatchPage's
// seek effect now does `if (freshSession) player.resetGuard(); player.seekTo(...)` as a single
// call — reset-then-arm happening atomically in one place — instead of a separate resetGuard()
// effect whose correctness depended on running before the seek effect in source declaration
// order. If resetGuard() ran AFTER seekTo() instead (the old bug this test's predecessor pinned
// via call order), it would silently clear the guard seekTo() just armed for the NEW session,
// letting a spurious autoplay leak through as a real, written PLAY.
//
// Drives a real end -> claim -> in-app replay flow (no reload) so the SAME YT.Player instance
// carries the guard across both sessions — same setup as watch-page-replay-restart.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";
import { watch as copy } from "@/frontend/public/constants/copy.th";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 44;
const ME_RESPONSE: MeResponse = { totalPoints: 0, rewardedVideoIds: [] };
const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };

// Session 1: already ended, not yet claimed. Its own SESSION_LOADED seek is
// seekTo(DURATION_SEC, {resume:false}) — the adapter arms the guard for it, and nothing in this
// test ever settles it (no PLAYING/PAUSED fires), so it's still armed when the replay lands.
const ENDED_SESSION: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "ENDED",
  positionSec: DURATION_SEC,
  furthestSec: DURATION_SEC,
  lastSeq: 5,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: null,
  passedQuestionIds: [],
  video: VIDEO,
  quizzes: [],
};

// The replay's fresh session: back at 0. Its own SESSION_LOADED seek is also
// seekTo(0, {resume:false}) — must correctly (re-)arm the guard for ITSELF, not inherit whatever
// the first session's own stale guard state was.
const REPLAY_SESSION: SessionCreateResponse = {
  sessionId: "sess-2",
  state: "CREATED",
  positionSec: 0,
  furthestSec: 0,
  lastSeq: 0,
  isReplay: true,
  alreadyRewarded: true,
  currentQuestionId: null,
  passedQuestionIds: [],
  video: VIDEO,
  quizzes: [],
};

const postedEventTypes: string[] = [];
const createSessionMock = vi.fn<() => Promise<SessionCreateResponse>>();

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => createSessionMock(),
    postAnswer: () => Promise.reject(new Error("not used in this test")),
    postClaim: () => Promise.resolve({ awarded: true, points: 50, totalPoints: 50 }),
    postEvents: (_sessionId: string, events: Array<{ type: string; positionSec: number }>): Promise<EventsApplyResponse> => {
      for (const e of events) postedEventTypes.push(e.type);
      return Promise.resolve({ state: "PAUSED", positionSec: 0, furthestSec: 0, lastSeq: postedEventTypes.length, currentQuestionId: null, results: [], remainingWatchSec: 0 });
    },
  },
}));

class FakePlayer {
  static instances: FakePlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  pauseVideoCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof FakePlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    FakePlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  /** Simulates the autoplay-after-seek quirk: a spurious PLAYING with no playVideo() of ours. */
  fireQuirkPlaying() {
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  playVideo() {}
  pauseVideo() {
    this.pauseVideoCallCount += 1;
  }
  seekTo() {}
  getCurrentTime() {
    return 0;
  }
  getPlayerState() {
    return YT_PLAYER_STATE.PAUSED;
  }
  setPlaybackRate() {}
  destroy() {
    this.container.querySelectorAll("iframe").forEach((el) => el.remove());
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
  FakePlayer.instances = [];
  postedEventTypes.length = 0;
  createSessionMock.mockReset();
  createSessionMock.mockResolvedValueOnce(ENDED_SESSION).mockResolvedValueOnce(REPLAY_SESSION);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { YT?: unknown }).YT;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WatchPage: a fresh session's seek still swallows a spurious PLAYING, even with a stale guard left armed by the previous session", () => {
  it("end (guard armed, never settled) -> claim -> replay (guard re-armed for the fresh session) -> a quirk PLAYING is paused straight back, never written as a real PLAY", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush(); // getMe + createSession(#1, ENDED) -> SESSION_LOADED (claiming) -> seekTo(44,{resume:false}) arms the guard
    await flush(); // useYouTubePlayer effect starts, FakePlayer constructed
    await flush(); // onReady -> player set; auto-claim effect fires -> postClaim -> CLAIM_ACCEPTED
    await flush(); // rewarded

    const player = FakePlayer.instances[0];
    expect(player, "FakePlayer must have been constructed").toBeTruthy();

    const rewatchButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === copy.rewardCard.rewatch);
    expect(rewatchButton, "the reward card's rewatch button must be present").toBeTruthy();

    act(() => rewatchButton!.click()); // handleReplay: dispatch(REPLAY_REQUESTED) + loadSession()
    await flush(); // createSession(#2, REPLAY) resolves -> SESSION_LOADED (freshSession seek to 0, resume:false)
    await flush(); // seek effect: resetGuard() then seekTo(0, {resume:false}) — SAME player instance, no remount
    await flush();

    expect(FakePlayer.instances, "the SAME player instance must be reused, not recreated (no reload happened)").toHaveLength(1);

    player.fireQuirkPlaying();
    await flush();

    expect(player.pauseVideoCallCount, "the spurious PLAYING must be swallowed — paused straight back").toBeGreaterThan(0);
    expect(postedEventTypes, "no real PLAY should ever be written for a swallowed quirk").not.toContain("PLAY");
  }, 15_000);
});
