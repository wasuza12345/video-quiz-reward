// @vitest-environment jsdom
//
// Once the ENDED_NOT_WATCHED recovery's tight-loop cap is hit, the backstop retry's delay
// used to be `(remainingWatchSec + 1) * 1000` ms — when
// remainingWatchSec is 0 (the player genuinely can't move; it's furthestSec, not playedWallSec,
// that's short, or the player is simply stuck), that's 1s, INSIDE ENDED_RECOVERY_TIGHT_WINDOW_SEC
// (2s). Every backstop-triggered attempt then landed inside the tight window of the one before
// it, so the attempt counter never reset below the cap, and the backstop kept rescheduling itself
// every ~1s forever — a steady ~1Hz ENDED loop with no backoff, until the server started 429ing
// it. Fixed by flooring the delay at ENDED_RECOVERY_TIGHT_WINDOW_SEC + 3 (5s), always outside the
// tight window, so a backstop-triggered retry is always treated as a fresh attempt.
//
// This drives the REAL WatchPage with a player that can never actually progress (playVideo() is a
// no-op — no further onStateChange of its own) so every ENDED send after the first burst is driven
// purely by the recovery's own setTimeout chain, isolating exactly the mechanism under test from
// real playback timing. A mock server that always rejects ENDED with remainingWatchSec: 0 matches
// the precondition this bug needs (a player that genuinely can't move).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 20;
const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };
const SESSION_RESPONSE: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "PLAYING",
  positionSec: DURATION_SEC,
  furthestSec: DURATION_SEC,
  lastSeq: 0,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: null,
  passedQuestionIds: [],
  video: VIDEO,
  quizzes: [],
};
const ME_RESPONSE: MeResponse = { totalPoints: 0, rewardedVideoIds: [] };

let seq = 0;
const postEventsCalls: Array<{ type: ClientEventType; positionSec: number }> = [];

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => Promise.resolve(SESSION_RESPONSE),
    postAnswer: () => Promise.reject(new Error("not used in this test")),
    postClaim: () => Promise.reject(new Error("not used in this test")),
    // Always NOT_WATCHED, remainingWatchSec always 0 — the player
    // genuinely can't move, so every recovery attempt fails identically, forever.
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      postEventsCalls.push(...events.map((e) => ({ type: e.type, positionSec: e.positionSec })));
      seq += 1;
      const last = events[events.length - 1];
      return Promise.resolve({
        state: "PLAYING",
        positionSec: last.positionSec,
        furthestSec: DURATION_SEC,
        lastSeq: seq,
        currentQuestionId: null,
        results: events.map((e) => ({ seq: e.seq, accepted: e.type !== "ENDED", rejectReason: e.type === "ENDED" ? "NOT_WATCHED" : null })),
        remainingWatchSec: 0,
      });
    },
  },
}));

/** A genuinely stuck player: seekTo()/playVideo() are recorded but produce no further
 * onStateChange of their own — every ENDED after the first manually-fired one must come from the
 * recovery's own setTimeout chain, not from the player reacting on its own. */
class StuckPlayer {
  static instances: StuckPlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  seekToCallCount = 0;
  playVideoCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof StuckPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    StuckPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime() {
    return DURATION_SEC;
  }
  playVideo() {
    this.playVideoCallCount += 1;
  }
  pauseVideo() {}
  seekTo() {
    this.seekToCallCount += 1;
  }
  getPlayerState() {
    return YT_PLAYER_STATE.ENDED;
  }
  setPlaybackRate() {}
  destroy() {
    this.container.querySelectorAll("iframe").forEach((el) => el.remove());
  }

  /** Test-only: simulates a real ENDED transition, the only way this stuck player ever reports
   * anything beyond construction. */
  fireEnded() {
    this.events.onStateChange({ data: YT_PLAYER_STATE.ENDED });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { YT: unknown }).YT = { Player: StuckPlayer };
  StuckPlayer.instances = [];
  seq = 0;
  postEventsCalls.length = 0;
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

describe("WatchPage: ENDED recovery backstop backoff", () => {
  it("bounded ENDED sends over 60s when the player can't move", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const player = StuckPlayer.instances[0];
    expect(player, "StuckPlayer must have been constructed").toBeTruthy();

    // Manually drive 3 tight re-ENDs (well within the 2s tight window) to reach the cap — mirrors
    // dev.db's own fast (~80ms-apart) initial burst before the client gives up trying a fresh
    // seek and falls back to the backstop timer alone.
    for (let i = 0; i < 3; i++) {
      act(() => player.fireEnded());
      await flush();
      await wait(50);
      await flush();
    }
    const endedAfterBurst = postEventsCalls.filter((e) => e.type === "ENDED").length;
    expect(endedAfterBurst, "the manual burst must have reached the tight-loop cap").toBe(3);

    // From here on, nothing but the recovery's own setTimeout chain can produce another ENDED —
    // the player itself never reacts on its own.
    for (let i = 0; i < 60; i++) {
      await wait(1_000);
      await flush();
    }

    const endedCalls = postEventsCalls.filter((e) => e.type === "ENDED");
    // The old (remainingWatchSec + 1)s = 1s delay is inside the 2s tight window, so it never
    // resets and reschedules itself every ~1s — over 60s that's ~60 additional sends (~63 total).
    // The fix floors the delay at 5s (outside the tight window), bounding this hard.
    expect(endedCalls.length, "ENDED sends must be bounded over 60s, not a steady ~1Hz loop (dev.db-style, until 429)").toBeLessThanOrEqual(15);
  }, 15_000);
});
