// @vitest-environment jsdom
//
// Pins the ordering between WatchPage's two [state.sessionId, player]-adjacent effects: the
// session-bookkeeping reset (declared first) and the "drop a stale autoplay guard" resetGuard()
// effect (declared second, but still BEFORE the pendingSeekTo effect further down the component).
// resetGuard() must run before the pendingSeekTo effect's own player.seekTo() call, because a
// fresh SESSION_LOADED always sets a new pendingSeekTo too — both effects fire in the same commit
// — and seekTo() is itself the last word on the guard's armed/cleared state for that seek. If
// resetGuard ran AFTER seekTo (or didn't run at all in the right place), it would silently
// overwrite whatever seekTo just correctly decided, e.g. clearing a guard seekTo(x,{resume:false})
// just armed for the new session's own non-autoplaying seek.
//
// Spies directly on YouTubePlayerAdapter.prototype so this pins the ACTUAL call order WatchPage
// produces, not just a semantic outcome that could coincidentally match either order.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import { YouTubePlayerAdapter } from "@/frontend/public/player/youtube-player-adapter";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 44;
const ME_RESPONSE: MeResponse = { totalPoints: 0, rewardedVideoIds: [] };
const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };

const SESSION_1: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "PAUSED",
  positionSec: 20,
  furthestSec: 20,
  lastSeq: 3,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: null,
  passedQuestionIds: [],
  video: VIDEO,
  quizzes: [],
};

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => Promise.resolve(SESSION_1),
    postAnswer: () => Promise.reject(new Error("not used in this test")),
    postClaim: () => Promise.reject(new Error("not used in this test")),
    postEvents: (): Promise<EventsApplyResponse> =>
      Promise.resolve({ state: "PAUSED", positionSec: 20, furthestSec: 20, lastSeq: 4, currentQuestionId: null, results: [], remainingWatchSec: 0 }),
  },
}));

class FakePlayer {
  static instances: FakePlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };

  constructor(container: HTMLElement, opts: { events: typeof FakePlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    FakePlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  playVideo() {}
  pauseVideo() {}
  seekTo() {}
  getCurrentTime() {
    return 20;
  }
  getPlayerState() {
    return 2; // PAUSED
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

describe("WatchPage: resetGuard() vs the pendingSeekTo effect — call order", () => {
  it("calls resetGuard() before seekTo() whenever a session load fires both in the same commit", async () => {
    const resetGuardSpy = vi.spyOn(YouTubePlayerAdapter.prototype, "resetGuard");
    const seekToSpy = vi.spyOn(YouTubePlayerAdapter.prototype, "seekTo");

    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush(); // getMe + createSession resolve -> SESSION_LOADED (status "ready", pendingSeekTo=20)
    await flush(); // useYouTubePlayer effect starts, loadYouTubeIframeApi resolves, FakePlayer constructed
    await flush(); // onReady fires -> player set -> both [sessionId, player] effects fire together

    expect(resetGuardSpy, "resetGuard() must have been called at least once, alongside the seek").toHaveBeenCalled();
    expect(seekToSpy, "seekTo() must have been called for the resumed session's own seek").toHaveBeenCalled();

    const resetGuardOrder = resetGuardSpy.mock.invocationCallOrder[0];
    const seekToOrder = seekToSpy.mock.invocationCallOrder[0];
    expect(
      resetGuardOrder,
      "resetGuard() must run BEFORE seekTo() — seekTo() is the authoritative last word on the " +
        "guard for this seek, so resetGuard running after it would silently undo what seekTo just decided",
    ).toBeLessThan(seekToOrder);
  }, 15_000);
});
