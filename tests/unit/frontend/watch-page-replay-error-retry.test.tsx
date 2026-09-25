// @vitest-environment jsdom
//
// Reviewer-found backlog bug: watch to the end -> claim -> Replay -> POST /api/sessions fails
// (offline or 5xx) -> error screen -> back online -> Retry -> the new session loads, but Play does
// nothing until a full reload.
//
// Root cause: the error phase used to return <ErrorState> from an early `return`, structurally
// separate from the rest of WatchPage's JSX tree. React reconciles by tree position, not by "same
// component elsewhere in the code" — so swapping from the normal render (which includes
// <VideoPlayer>) to that early-return branch unmounted <VideoPlayer>'s container div, detaching the
// real YT iframe. useYouTubePlayer's effect only reruns on [youtubeId, title] (unchanged for a
// same-video replay), so `player` (React state) kept referencing the now-detached instance forever:
// once Retry's SESSION_LOADED landed and <VideoPlayer> remounted with a NEW container div, Play
// called playVideo() on the OLD, orphaned instance — a silent no-op.
//
// Renders the REAL WatchPage against a REAL (unmocked) useWatchTracker/WatchTracker, same approach
// as watch-page-replay-restart.test.tsx, whose ReplayTestPlayer this borrows: its playVideo()/
// pauseVideo()/seekTo() already no-op once their container is detached from document.body, modelling
// a real orphaned iframe's silently-ignored postMessage commands.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";
import { watch as copy } from "@/frontend/public/constants/copy.th";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 44;
const ME_RESPONSE: MeResponse = { totalPoints: 50, rewardedVideoIds: ["v1"] };

const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };
const QUIZ = { id: "q1", triggerSec: 13, prompt: "คำถามทดสอบ", choices: [{ label: "A", text: "choice-a-text" }, { label: "B", text: "choice-b-text" }] };

const ENDED_SESSION: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "ENDED",
  positionSec: DURATION_SEC,
  furthestSec: DURATION_SEC,
  lastSeq: 5,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: null,
  passedQuestionIds: ["q1"],
  video: VIDEO,
  quizzes: [QUIZ],
};

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
  quizzes: [QUIZ],
};

let serverFurthest = 0;
let seq = 0;
const createSessionMock = vi.fn<() => Promise<SessionCreateResponse>>();

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => createSessionMock(),
    postAnswer: () => Promise.reject(new Error("not used in this test")),
    postClaim: () => Promise.resolve({ awarded: true, points: 50, totalPoints: 50 }),
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      const last = events[events.length - 1];
      serverFurthest = Math.max(serverFurthest, last.positionSec);
      seq += 1;
      return Promise.resolve({
        state: "PLAYING",
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

const PLAYBACK_SPEED = 8;

/** Copied from watch-page-replay-restart.test.tsx — see that file's own comment on why
 * playVideo()/pauseVideo()/seekTo() no-op once the container is detached from document.body: that's
 * exactly what a real orphaned YT iframe's silently-ignored postMessage commands look like. */
class ReplayTestPlayer {
  static instances: ReplayTestPlayer[] = [];

  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  baseTime = DURATION_SEC;
  private segmentStartMs: number | null = null;
  seekToCallCount = 0;
  playVideoCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof ReplayTestPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    ReplayTestPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  private isAttached(): boolean {
    return document.body.contains(this.container);
  }

  getCurrentTime(): number {
    if (this.segmentStartMs === null) return this.baseTime;
    return this.baseTime + (PLAYBACK_SPEED * (performance.now() - this.segmentStartMs)) / 1000;
  }

  playVideo() {
    if (!this.isAttached()) return;
    this.playVideoCallCount += 1;
    if (this.pendingSeekWhileEnded !== null) {
      this.baseTime = this.pendingSeekWhileEnded;
      this.pendingSeekWhileEnded = null;
    }
    this.segmentStartMs = performance.now();
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  pauseVideo() {
    if (!this.isAttached()) return;
    this.baseTime = this.getCurrentTime();
    this.segmentStartMs = null;
    this.events.onStateChange({ data: YT_PLAYER_STATE.PAUSED });
  }

  private pendingSeekWhileEnded: number | null = null;

  seekTo(seconds: number) {
    if (!this.isAttached()) return;
    this.seekToCallCount += 1;
    const isEnded = this.segmentStartMs === null && this.baseTime >= DURATION_SEC;
    if (isEnded) {
      this.pendingSeekWhileEnded = seconds;
      return;
    }
    this.baseTime = seconds;
    if (this.segmentStartMs !== null) this.segmentStartMs = performance.now();
  }

  getPlayerState() {
    if (this.segmentStartMs !== null) return YT_PLAYER_STATE.PLAYING;
    return this.baseTime >= DURATION_SEC ? YT_PLAYER_STATE.ENDED : YT_PLAYER_STATE.PAUSED;
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
  (window as unknown as { YT: unknown }).YT = { Player: ReplayTestPlayer };
  ReplayTestPlayer.instances = [];
  serverFurthest = 0;
  seq = 0;
  createSessionMock.mockReset();
  createSessionMock
    .mockResolvedValueOnce(ENDED_SESSION) // initial load: already-ended session
    .mockRejectedValueOnce(new Error("offline")) // Replay's own reload fails
    .mockResolvedValueOnce(REPLAY_SESSION); // Retry succeeds
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
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

describe("WatchPage: replay's session reload fails, then Retry keeps a live player", () => {
  it("end -> claim -> replay (fails) -> error screen keeps the iframe attached -> Retry -> Play actually reaches the SAME player instance", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush(); // getMe + createSession(#1, ENDED) -> SESSION_LOADED (phase "claiming")
    await flush(); // useYouTubePlayer effect starts, ReplayTestPlayer constructed
    await flush(); // onReady fires -> player set; auto-claim effect fires -> postClaim -> CLAIM_ACCEPTED
    await flush(); // phase "rewarded"

    const player = ReplayTestPlayer.instances[0];
    expect(player, "ReplayTestPlayer must have been constructed").toBeTruthy();
    expect(container.querySelector("iframe"), "sanity: the player's iframe is in the live tree").toBeTruthy();

    const rewatchButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === copy.rewardCard.rewatch);
    expect(rewatchButton, "the reward card's rewatch button must be present").toBeTruthy();

    act(() => rewatchButton!.click()); // handleReplay: dispatch(REPLAY_REQUESTED) + loadSession()
    await flush(); // createSession(#2) rejects -> SESSION_LOAD_FAILED (phase "error", reloadingInPlace still true)

    const errorHeading = Array.from(container.querySelectorAll("h2")).find((h) => h.textContent === copy.error.sessionLoadFailed.title);
    expect(errorHeading, "the error screen must be showing").toBeTruthy();

    // The regression this test guards against: an early `return <ErrorState/>` structurally
    // separate from the rest of the render unmounts <VideoPlayer>'s container along with the real
    // iframe inside it. Once that happens, no later Retry can recover it — this is the one
    // assertion that catches the actual defect at its source, before Play ever gets a chance to
    // silently no-op.
    expect(container.querySelector("iframe"), "the player's iframe must stay attached through the error screen, not be unmounted with <VideoPlayer>").toBeTruthy();
    expect(ReplayTestPlayer.instances, "no new player must have been created just from failing to reload").toHaveLength(1);

    const retryButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === copy.error.sessionLoadFailed.action);
    expect(retryButton, "the error screen's retry action must be present").toBeTruthy();

    act(() => retryButton!.click()); // handleRetry: dispatch(RETRY_REQUESTED) + loadSession()
    await flush(); // createSession(#3, REPLAY) resolves -> SESSION_LOADED (phase "ready", reloadingInPlace cleared)
    await flush();

    expect(ReplayTestPlayer.instances, "Retry succeeding must still reuse the SAME player instance, not recreate one").toHaveLength(1);

    const btn = toggleButton();
    expect(btn.disabled, "the toggle button must be enabled after a successful retry").toBe(false);
    act(() => btn.click()); // the user's real Play tap
    await flush();

    expect(player.playVideoCallCount, "playVideo() must actually reach the live player, not a detached one").toBeGreaterThan(0);
    expect(player.getPlayerState(), "the player must genuinely be PLAYING, not silently stuck").toBe(YT_PLAYER_STATE.PLAYING);

    await wait(150);
    expect(player.getCurrentTime(), "playback must be advancing, proving the command reached a live iframe").toBeGreaterThan(0);
  }, 20_000);
});
