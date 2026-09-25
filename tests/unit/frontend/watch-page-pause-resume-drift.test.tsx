// @vitest-environment jsdom
//
// Planner review, round 2: the round-1 fix (WatchTracker.notePaused, called from onStateChange
// PAUSED only) still reproduced in the human's real Chrome — dev.db session 5556d645 showed the
// exact same pattern (PAUSE 2.28 -> PLAY 2.54 -> a corrective PLAY ~2.48 about 1.5s later),
// repeated across 5 cycles, softRejectCount=0, no rejections.
//
// The round-1 model was backwards: it put the ~0.27s YouTube pause-settle creep INTO the PAUSED
// event's own reported position. In real YouTube, getCurrentTime() at PAUSED is itself STALE —
// the creep isn't visible yet there; it only shows up at the NEXT genuine PLAYING read, once the
// player actually resumes. notePaused(2.28) was therefore a no-op (2.28 already matched the
// high-water mark), and the resume's own PLAYING at 2.54 was never trusted either — landing every
// frame since in onFrame's "not yet trusted" middle band, same bug, different call site.
//
// Fix: WatchTracker.notePaused -> noteSettled, called from BOTH onStateChange(PAUSED) *and* the
// genuine (non-swallowed) PLAYING branch. DriftingPlayer here reports the drift-free position at
// PAUSED and reveals the +0.27s creep only at the next playVideo() call, matching the real
// sequence above. This renders the REAL WatchPage against a REAL useWatchTracker/WatchTracker
// (unlike watch-page-autoplay-guard.test.tsx, which mocks the tracker out entirely) — this test
// exists specifically to prove the tracker's real anti-cheat loop, driven by real rAF, doesn't
// misfire.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";
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
        remainingWatchSec: 0,
      });
    },
  },
}));

const PAUSE_DRIFT_SEC = 0.27;

/** Models the real YouTube IFrame API's pause-settle creep faithfully: PAUSED reports the clean,
 * un-drifted position (whatever the last honest frame caught); the +0.27s creep is only revealed
 * at the NEXT playVideo() call's own PLAYING report — see file header. */
class DriftingPlayer {
  static instances: DriftingPlayer[] = [];

  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private baseTime = 0;
  private segmentStartMs: number | null = null;
  /** The hidden creep accrued while paused, not yet revealed via any reported position. */
  private pendingDrift = 0;
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
    this.baseTime += this.pendingDrift; // the creep becomes visible only now
    this.pendingDrift = 0;
    this.segmentStartMs = performance.now();
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  pauseVideo() {
    this.baseTime = this.getCurrentTime(); // PAUSED's own read is stale — no drift added here
    this.pendingDrift = PAUSE_DRIFT_SEC;
    this.segmentStartMs = null;
    this.events.onStateChange({ data: YT_PLAYER_STATE.PAUSED });
  }

  seekTo(seconds: number) {
    this.seekToCallCount += 1;
    this.baseTime = seconds;
    this.pendingDrift = 0;
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

describe("WatchPage + real WatchTracker: pause/resume drift", () => {
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

    // Baseline, not 0: SESSION_LOADED now always seeks to positionSec (including 0) so an in-app
    // replay of the same video restarts a reused, still-ENDED player ("replay restarts from 0")
    // — a fresh player's own one-time seekTo(0, true) on session load
    // is expected and unrelated to the anti-cheat concern this test covers.
    const baselineSeekToCallCount = player!.seekToCallCount;

    for (let cycle = 0; cycle < 5; cycle++) {
      act(() => toggleButton().click()); // pause — settles cleanly; the +0.27s creep stays hidden
      await flush();
      expect(resyncToastVisible(), `cycle ${cycle}: no resync toast right after pausing`).toBe(false);

      await wait(150); // a beat while genuinely paused
      act(() => toggleButton().click()); // resume — reveals the +0.27s creep via this PLAYING read
      await flush();
      expect(player!.seekToCallCount - baselineSeekToCallCount, `cycle ${cycle}: no corrective seekTo() right after resuming`).toBe(0);

      // Every honest frame from here needs to be tracked normally, not left stuck in onFrame's
      // "not yet trusted" middle band. If the resume's drift wasn't absorbed (the PLAYING-side
      // noteSettled call missing, as on 96893d3), this is exactly the window — a single
      // continuous "playing" stretch with no intervening pause to (re-)settle it — where the gap
      // between the stuck high-water mark and the still-advancing currentTime crosses
      // SEEK_GUARD_SLACK_SEC (1.5s) and the seek guard snaps back. 1.6s real time > 1.5s - 0.27s
      // with margin for rAF/test scheduling jitter.
      await wait(1_600);
      act(() => toggleButton().click()); // pause again for the next cycle
      await flush();
    }

    expect(player!.seekToCallCount - baselineSeekToCallCount, "no CLIENT_SEEK_GUARD corrective seekTo() call at any point").toBe(0);
    expect(resyncToastVisible(), "no resync toast at any point").toBe(false);
  }, 30_000);
});
