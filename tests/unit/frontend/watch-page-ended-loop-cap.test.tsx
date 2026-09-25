// @vitest-environment jsdom
//
// ENDED_NOT_WATCHED recovery must never loop: once a recovery's seek-back itself landed close
// enough to the true end, the player used to immediately re-fire ENDED, ~110 times in a row,
// ~80ms apart, each one a soft reject.
//
// That alone could still strand an honest viewer forever. If
// the server's playedWallSec is short (credit is capped at 10s/event — a mobile stall, a slow
// write, or background throttling can all make it fall behind) but furthestSec is already near the
// end, the CLIENT's own (credit-capped, less reliable) local estimate of the deficit came out <= 0
// (dev.db: server playedWall 33 vs furthest 43.5), so the recovery's own seek landed right back at
// the end — ENDED again immediately, forever. Fixed by having the server report its own
// authoritative remainingWatchSec (reward-policy.ts) and having the client seek back far enough for
// genuine real playback to cover the deficit, plus a tight-loop-vs-fresh-attempt distinction so a
// re-ENDED after real playback (not a stuck loop) resets the cap instead of counting against it.
//
// This drives the REAL WatchPage against a REAL (unmocked) useWatchTracker/WatchTracker, and a mock
// server built on the REAL domain reducer (applyClientEvents/remainingWatchSec) so the server-side
// playedWallSec math is exactly production's, not a hand-rolled approximation. To reproduce the
// round-5 precondition faithfully — furthest genuinely at the end (from real playback) while
// playedWallSec is still short, AND the client's own local wall-clock sense of "how long I've been
// playing" already exceeds what the server credited (the actual reason the OLD per-client-estimate
// formula computed a <= 0 deficit) — the mock lets the player really play through the whole video
// once while a "credit gap" holds the server's playedWallSec back (simulating the same real-world
// stall/slow-write/background-throttle credit loss dev.db showed), then lifts the gap right when
// the first ENDED is rejected. From there, whether recovery ever succeeds depends only on the real
// fix, not on the test's own bookkeeping.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyClientEvents } from "@/backend/domain/session-state-machine";
import { remainingWatchSec as computeRemainingWatchSec } from "@/backend/domain/reward-policy";
import type { ClientEvent, SessionSnapshot, VideoRules } from "@/backend/domain/types";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 12;
const VIDEO_RULES: VideoRules = { durationSec: DURATION_SEC, questions: [] };
const REQUIRED_WALL_SEC = 0.9 * DURATION_SEC; // 10.8
const INITIAL_DEFICIT_SEC = 8; // server playedWall 8s short

const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };
const SESSION_RESPONSE: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "PLAYING",
  positionSec: 0,
  furthestSec: 0,
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
let createSessionCallCount = 0;
let claimCallCount = 0;
const postEventsCalls: Array<{ type: ClientEventType; positionSec: number }> = [];

// The mock "server": a real SessionSnapshot run through the REAL domain reducer, so its
// playedWallSec/furthestSec/bank math is exactly production's.
let mockSession: SessionSnapshot;
// True until the first ENDED is processed: real playback still moves position/furthestSec (and
// still refills the bank normally, so honest real-time TICKs are never themselves rejected), but
// the resulting playedWallSec credit is held back — modeling the same real-world credit loss
// dev.db showed, without needing to fake a slow network in this harness.
let creditGapActive = true;

function resetMockSession() {
  mockSession = {
    state: "PLAYING",
    isReplay: false,
    currentQuestionId: null,
    passedQuestionIds: [],
    positionSec: 0,
    furthestSec: 0,
    playedWallSec: REQUIRED_WALL_SEC - INITIAL_DEFICIT_SEC,
    bankSec: 10,
    lastPlayingAt: new Date(),
    softRejectCount: 0,
    flagged: false,
    endedAt: null,
  };
  creditGapActive = true;
}

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => {
      createSessionCallCount += 1;
      return Promise.resolve(SESSION_RESPONSE);
    },
    postAnswer: () => Promise.reject(new Error("not used in this test")),
    postClaim: () => {
      claimCallCount += 1;
      return Promise.resolve({ awarded: true, points: 50, totalPoints: 50 });
    },
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      postEventsCalls.push(...events.map((e) => ({ type: e.type, positionSec: e.positionSec })));
      seq += 1;
      const domainEvents: ClientEvent[] = events.map((e) => ({ seq: e.seq, type: e.type, positionSec: e.positionSec }));
      const before = mockSession.playedWallSec;
      const { session: next, events: records } = applyClientEvents(mockSession, VIDEO_RULES, domainEvents, new Date());
      if (creditGapActive) {
        mockSession = { ...next, playedWallSec: before };
        if (domainEvents.some((e) => e.type === "ENDED")) creditGapActive = false;
      } else {
        mockSession = next;
      }
      return Promise.resolve({
        state: mockSession.state,
        positionSec: mockSession.positionSec,
        furthestSec: mockSession.furthestSec,
        lastSeq: seq,
        currentQuestionId: mockSession.currentQuestionId,
        results: records.map((r) => ({ seq: r.seq!, accepted: r.accepted, rejectReason: r.rejectReason })),
        remainingWatchSec: computeRemainingWatchSec(mockSession, VIDEO_RULES),
      });
    },
  },
}));

/** A real IFrame-like player: playVideo() actually advances in real wall-clock time and fires a
 * genuine ENDED on its own once it reaches DURATION_SEC — unlike a player that always re-fires
 * ENDED immediately, real playback after a seek genuinely closes the deficit, exactly what the fix
 * depends on. seekTo() alone while at ENDED doesn't resume playback (matches the real IFrame API
 * quirk documented elsewhere in this suite); only a playVideo() call right after does — exactly
 * what WatchPage's pendingSeekTo effect does. */
class RecoveryPlayer {
  static instances: RecoveryPlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private baseTime = 0;
  private segmentStartMs: number | null = null;
  private endedTimer: ReturnType<typeof setTimeout> | null = null;
  seekToCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof RecoveryPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    RecoveryPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime(): number {
    if (this.segmentStartMs === null) return this.baseTime;
    return Math.min(DURATION_SEC, this.baseTime + (performance.now() - this.segmentStartMs) / 1000);
  }

  playVideo() {
    if (this.segmentStartMs !== null) return; // already playing
    if (this.baseTime >= DURATION_SEC) return; // still at ENDED with no seek yet — real quirk, silent no-op
    this.segmentStartMs = performance.now();
    const remainingMs = (DURATION_SEC - this.baseTime) * 1000;
    this.endedTimer = setTimeout(() => {
      this.baseTime = DURATION_SEC;
      this.segmentStartMs = null;
      this.endedTimer = null;
      this.events.onStateChange({ data: YT_PLAYER_STATE.ENDED });
    }, remainingMs);
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  pauseVideo() {
    this.baseTime = this.getCurrentTime();
    this.segmentStartMs = null;
    if (this.endedTimer !== null) {
      clearTimeout(this.endedTimer);
      this.endedTimer = null;
    }
  }

  seekTo(seconds: number) {
    this.seekToCallCount += 1;
    this.baseTime = Math.max(0, Math.min(DURATION_SEC, seconds));
    if (this.endedTimer !== null) {
      clearTimeout(this.endedTimer);
      this.endedTimer = null;
    }
    if (this.segmentStartMs !== null) this.segmentStartMs = performance.now();
  }

  getPlayerState() {
    return this.segmentStartMs === null ? YT_PLAYER_STATE.PAUSED : YT_PLAYER_STATE.PLAYING;
  }
  setPlaybackRate() {}
  destroy() {
    this.container.querySelectorAll("iframe").forEach((el) => el.remove());
    if (this.endedTimer !== null) clearTimeout(this.endedTimer);
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { YT: unknown }).YT = { Player: RecoveryPlayer };
  RecoveryPlayer.instances = [];
  seq = 0;
  createSessionCallCount = 0;
  claimCallCount = 0;
  postEventsCalls.length = 0;
  resetMockSession();
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

describe("WatchPage: ENDED_NOT_WATCHED recovery", () => {
  it("server playedWall 8s short, furthest at the end: recovers via real playback to ENDED accepted + claim +50, no reload, bounded ENDED sends", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const player = RecoveryPlayer.instances[0];
    expect(player, "RecoveryPlayer must have been constructed").toBeTruthy();

    // Mount auto-resumes a real, full playthrough (session state "PLAYING", from position 0) while
    // the credit gap holds the server's playedWallSec back — the player genuinely reaches the end
    // on its own, exactly like an honest viewer who really did watch the whole thing. This is the
    // FIRST ENDED; the mock server rejects it (NOT_WATCHED, playedWall 8s short) and lifts the gap.
    await wait(DURATION_SEC * 1000 + 600);
    await flush();

    const endedAfterFirstPass = postEventsCalls.filter((e) => e.type === "ENDED").length;
    expect(endedAfterFirstPass, "the first real ENDED must have been rejected (playedWall still short)").toBe(1);
    expect(mockSession.state, "must not already be ENDED before the recovery even starts").not.toBe("ENDED");

    // Let the recovery's seek-back + real resumed playback run all the way to a genuine second
    // ENDED and the auto-claim that follows — generous margin over the ~10s the corrected seek
    // formula needs (remainingWatchSec 8 + END_SLACK_SEC 2, independent of DURATION_SEC).
    for (let i = 0; i < 16; i++) {
      await wait(1_000);
      await flush();
    }

    const endedCalls = postEventsCalls.filter((e) => e.type === "ENDED");
    expect(endedCalls.length, "ENDED sends must be bounded, not unbounded (dev.db: ~110 in a row)").toBeLessThanOrEqual(8);
    expect(endedCalls.length, "must have actually retried after the first NOT_WATCHED, not given up").toBeGreaterThanOrEqual(2);

    expect(mockSession.state, "the server must have eventually accepted ENDED once real playback covered the deficit").toBe("ENDED");
    expect(createSessionCallCount, "no reload: exactly one session bootstrap for the whole recovery").toBe(1);
    expect(claimCallCount, "the claim must have gone out automatically once ENDED was accepted").toBe(1);
    expect(container.textContent, "the reward must have been claimed").toContain("50");
  }, 45_000);
});
