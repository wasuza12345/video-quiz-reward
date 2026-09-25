// @vitest-environment jsdom
//
// Planner review: real production bug (dev.db evidence: PAUSE 6.91 -> PLAY 7.18 -> a second,
// corrective PLAY ~7.11 about 1.5s later) — every honest pause/resume mid-video triggered a
// spurious resync toast + backward snap, even though the server accepted every single event
// (softRejectCount=0, no rejections). Root cause: YouTube's PAUSED state change lands ~0.27s
// after the underlying player has already coasted forward past it — useWatchTracker's rAF loop
// only runs while `active` (state.status === "playing"), so by the time PAUSED fires and status
// flips to "paused", the loop stops and the tracker's local high-water mark is left ~0.27s BEHIND
// wherever the player actually settled. That's already past ADVANCE_FLOOR_SEC (0.25s), so on
// resume every frame lands in onFrame's "not yet trusted" middle band forever — the gap only
// grows until it crosses SEEK_GUARD_SLACK_SEC (1.5s) and the seek guard snaps back.
//
// This renders the REAL WatchPage against a REAL useWatchTracker/WatchTracker (unlike
// watch-page-autoplay-guard.test.tsx, which mocks the tracker out entirely — this test exists
// specifically to prove the tracker's real anti-cheat loop, driven by real rAF, doesn't misfire).
// DriftingPlayer models the ~0.27s YouTube pause lag: pauseVideo() freezes the reported position
// 0.27s AHEAD of wherever it was actually caught by the last honest frame, exactly reproducing the
// gap without needing any deeper opinion on the real IFrame API's own internal mechanics.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/hooks/useYouTubePlayer";
import { watch as copy } from "@/frontend/public/constants/copy.th";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const ME_RESPONSE: MeResponse = { totalPoints: 0, rewardedVideoIds: [] };
const SESSION_RESPONSE: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "CREATED",
  positionSec: 0,
  furthestSec: 0,
  lastSeq: 0,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: null,
  passedQuestionIds: [],
  video: { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: 300, rewardPoints: 50 },
  quizzes: [], // no gate anywhere near the ~5s of positions this test ever reaches
};

let serverFurthest = 0;
let seq = 0;

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => Promise.resolve(SESSION_RESPONSE),
    postAnswer: () => Promise.reject(new Error("not used in this test")),
    postClaim: () => Promise.reject(new Error("not used in this test")),
    // Mirrors what a real server actually reports for the event just sent — a hardcoded "PLAYING"
    // regardless of type would be exactly the mock-realism bug this suite has hit before (see
    // watch-page-autoplay-guard.test.tsx's own comment on the same pitfall).
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      const last = events[events.length - 1];
      serverFurthest = Math.max(serverFurthest, last.positionSec);
      seq += 1;
      const state = last.type === "PAUSE" ? "PAUSED" : "PLAYING";
      return Promise.resolve({
        state,
        positionSec: last.positionSec,
        furthestSec: serverFurthest,
        lastSeq: seq,
        currentQuestionId: null,
        results: events.map((e) => ({ seq: e.seq, accepted: true, rejectReason: null })),
      });
    },
  },
}));

const PAUSE_DRIFT_SEC = 0.27;

/** Models the real YouTube IFrame API's pause lag: by the time onStateChange(PAUSED) fires, the
 * reported position is ~0.27s ahead of wherever the last honest frame caught it — see file header. */
class DriftingPlayer {
  static instances: DriftingPlayer[] = [];

  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private baseTime = 0;
  private segmentStartMs: number | null = null;
  seekToCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof DriftingPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    DriftingPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime(): number {
    if (this.segmentStartMs === null) return this.baseTime;
    return this.baseTime + (performance.now() - this.segmentStartMs) / 1000;
  }

  playVideo() {
    this.segmentStartMs = performance.now();
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  pauseVideo() {
    this.baseTime = this.getCurrentTime() + PAUSE_DRIFT_SEC;
    this.segmentStartMs = null;
    this.events.onStateChange({ data: YT_PLAYER_STATE.PAUSED });
  }

  seekTo(seconds: number) {
    this.seekToCallCount += 1;
    this.baseTime = seconds;
    if (this.segmentStartMs !== null) this.segmentStartMs = performance.now();
  }

  getPlayerState() {
    return this.segmentStartMs === null ? YT_PLAYER_STATE.PAUSED : YT_PLAYER_STATE.PLAYING;
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
  (window as unknown as { YT: unknown }).YT = { Player: DriftingPlayer };
  DriftingPlayer.instances = [];
  serverFurthest = 0;
  seq = 0;
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

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function toggleButton(): HTMLButtonElement {
  const matches = Array.from(container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${copy.controlBar.pauseAriaLabel}"], button[aria-label="${copy.controlBar.playAriaLabel}"]`));
  const btn = matches[matches.length - 1];
  if (!btn) throw new Error("toggle button not rendered");
  return btn;
}

function resyncToastVisible(): boolean {
  return Array.from(container.querySelectorAll('[role="status"]')).some((el) => el.textContent === copy.toast.resync);
}

describe("WatchPage + real WatchTracker: pause/resume drift (planner review, must fail on 8aa7e90)", () => {
  it("5 pause/resume cycles with a ~0.27s YouTube pause-settle drift trigger no seek guard and no resync toast", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => {
      root.render(<WatchPage videoId="v1" />);
    });
    await flush(); // getMe + createSession -> SESSION_LOADED (status "ready", positionSec 0)
    await flush(); // useYouTubePlayer effect starts, DriftingPlayer constructed
    await flush(); // onReady fires -> player set
    const player = DriftingPlayer.instances[0];
    expect(player, "DriftingPlayer must have been constructed").toBeTruthy();

    act(() => toggleButton().click()); // the initial, real user Play — starts DriftingPlayer's own clock
    await flush(); // PLAYING -> PLAY_CLICKED -> status "playing" -> tracker's rAF loop starts (active === true)

    for (let cycle = 0; cycle < 5; cycle++) {
      await wait(300); // a bit of honest playback before pausing
      act(() => toggleButton().click()); // pause — DriftingPlayer applies the +0.27s settle drift
      await flush();
      expect(resyncToastVisible(), `cycle ${cycle}: no resync toast right after pausing`).toBe(false);

      await wait(150); // a beat while genuinely paused
      act(() => toggleButton().click()); // resume
      await flush();
    }

    // One more stretch of honest playback after the last resume — this is exactly the window
    // where the unfixed tracker's frozen high-water mark would finally cross SEEK_GUARD_SLACK_SEC
    // and snap back.
    await wait(400);
    await flush();

    expect(player!.seekToCallCount, "no CLIENT_SEEK_GUARD corrective seekTo() call at any point").toBe(0);
    expect(resyncToastVisible(), "no resync toast at any point").toBe(false);
  }, 20_000);
});
