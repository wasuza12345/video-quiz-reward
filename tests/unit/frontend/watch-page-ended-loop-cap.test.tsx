// @vitest-environment jsdom
//
// Planner review round 4, BLOCKER #2: ENDED_NOT_WATCHED recovery must never loop. dev.db: once a
// recovery's seek-back itself landed close enough to the true end, the player immediately re-fired
// ENDED — ~110 times in a row, ~80ms apart, each one a soft reject (see BLOCKER #3's separate fix).
//
// This drives the REAL WatchPage against a REAL (unmocked) useWatchTracker/WatchTracker with a
// mock server that ALWAYS reports NOT_WATCHED (an unrecoverable case by construction, isolating
// the client-side cap itself from any particular server-side arithmetic) and asserts the client
// gives up after a bounded number of attempts instead of sending ENDED forever.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/hooks/useYouTubePlayer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 44;
const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };
const SESSION_RESPONSE: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "PLAYING",
  positionSec: 10,
  furthestSec: 10,
  lastSeq: 3,
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
    // Always NOT_WATCHED, regardless of position — an unrecoverable case by construction, so any
    // ENDED sent here proves the client is still retrying (or has correctly stopped).
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      postEventsCalls.push(...events.map((e) => ({ type: e.type, positionSec: e.positionSec })));
      seq += 1;
      const last = events[events.length - 1];
      return Promise.resolve({
        state: last.type === "ENDED" ? "PLAYING" : "PLAYING",
        positionSec: last.positionSec,
        furthestSec: 10, // pinned — never credited further, matching a genuinely unwatched session
        lastSeq: seq,
        currentQuestionId: null,
        results: events.map((e) => ({ seq: e.seq, accepted: e.type !== "ENDED", rejectReason: e.type === "ENDED" ? "NOT_WATCHED" : null })),
      });
    },
  },
}));

/** Fires ENDED on every playVideo() almost immediately — the seek-back "recovery" in this test
 * never actually escapes the end, exactly the runaway scenario the cap has to survive. */
class AlwaysEndsPlayer {
  static instances: AlwaysEndsPlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  seekToCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof AlwaysEndsPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    AlwaysEndsPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime() {
    return DURATION_SEC;
  }
  playVideo() {
    this.events.onStateChange({ data: YT_PLAYER_STATE.ENDED });
  }
  fireEnded() {
    this.events.onStateChange({ data: YT_PLAYER_STATE.ENDED });
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
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { YT: unknown }).YT = { Player: AlwaysEndsPlayer };
  AlwaysEndsPlayer.instances = [];
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
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WatchPage: ENDED_NOT_WATCHED recovery never loops (planner review round 4, must fail on 85f71dd)", () => {
  it("caps retries instead of re-sending ENDED forever when the recovery can never actually escape the end", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const player = AlwaysEndsPlayer.instances[0];
    expect(player, "AlwaysEndsPlayer must have been constructed").toBeTruthy();

    // The player starts already at ENDED (getCurrentTime always returns DURATION_SEC) — firing
    // its own ENDED once kicks off the real recovery cycle: ENDED -> NOT_WATCHED -> seek-back ->
    // playVideo() -> (this fake) immediately ENDED again -> repeat.
    act(() => player.fireEnded());
    // Several rounds of flushing let each promise-driven recovery cycle run its course.
    for (let i = 0; i < 10; i++) await flush();

    const endedCalls = postEventsCalls.filter((e) => e.type === "ENDED");
    expect(endedCalls.length, "ENDED sends must be bounded, not unbounded (dev.db: ~110 in a row)").toBeLessThanOrEqual(4);
  }, 15_000);
});
