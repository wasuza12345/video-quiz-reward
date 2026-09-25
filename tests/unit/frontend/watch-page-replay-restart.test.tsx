// @vitest-environment jsdom
//
// Planner review: real production bug (dev.db session 5556d645 -> replay session 5d8abcc7). The
// human watched to the end, claimed the reward, then clicked the in-page "watch again" action —
// no page reload (log: no GET /watch, only POST /api/sessions creating the new replay session at
// positionSec 0). The UI showed 0:44 / 0:44 with the bar full, and Play did nothing: the session's
// only events were 2x TAB_HIDDEN, no PLAY at all.
//
// Root cause: useYouTubePlayer's effect depends only on [youtubeId, title] — a same-video replay
// with no reload never reruns it, so the SAME YT.Player instance is reused, still sitting at
// ENDED at the old video's duration. watch.reducer.ts's SESSION_LOADED only set pendingSeekTo when
// positionSec > 0 (an optimization that assumed a fresh player already sits at 0 on its own — true
// after a real reload, false when the player is reused). With pendingSeekTo staying null, nothing
// ever told the reused player to seek back to 0: the display read player.getCurrentTime() (44),
// and YouTube doesn't resume playback from an ENDED player without a seek first, so Play was a
// silent no-op with no state change and no PLAY event.
//
// Renders the REAL WatchPage against a REAL (unmocked) useWatchTracker/WatchTracker — same
// approach as watch-page-pause-resume-drift.test.tsx — with a player that starts already sitting
// at the end (simulating "already played through" without needing to actually simulate 44s of
// real playback) and advances at 8x real time once resumed (comfortably under onFrame's
// per-frame ADVANCE_FLOOR_SEC/ADVANCE_RATE budget, so it never trips the seek guard on its own),
// so reaching the quiz gate at 13s only takes ~1.6s of real test time.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/hooks/useYouTubePlayer";
import { formatTime, watch as copy } from "@/frontend/public/constants/copy.th";

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
    // Mirrors what a real server actually reports for the event just sent — see the repeated
    // "mock realism" comment in the other WatchPage integration tests in this suite.
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      const last = events[events.length - 1];
      serverFurthest = Math.max(serverFurthest, last.positionSec);
      seq += 1;
      // A PAUSE at/past the quiz trigger is the gate's own write — a real server reaches
      // QUIZ_PENDING from exactly this event (see watch-page-autoplay-guard.test.tsx's own comment
      // on the same mock-realism pitfall: a wrong state here masks or mimics real defects).
      const gateHit = last.type === "PAUSE" && last.positionSec >= QUIZ.triggerSec;
      const state = gateHit ? "QUIZ_PENDING" : last.type === "PAUSE" ? "PAUSED" : "PLAYING";
      return Promise.resolve({
        state,
        positionSec: last.positionSec,
        furthestSec: serverFurthest,
        lastSeq: seq,
        currentQuestionId: gateHit ? QUIZ.id : null,
        results: events.map((e) => ({ seq: e.seq, accepted: true, rejectReason: null })),
        remainingWatchSec: 0,
      });
    },
  },
}));

const PLAYBACK_SPEED = 8; // real-time multiplier — stays well under onFrame's per-frame accept budget

/** Starts already sitting at the end (baseTime = DURATION_SEC) — simulating "already played
 * through a prior session" without needing to actually simulate that playback. Advances at
 * PLAYBACK_SPEED x real time once playing. seekTo() is a genuine, non-autoplaying no-op, matching
 * the common case already established by the other WatchPage integration tests in this suite. */
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

  /** React swapping <VideoPlayer> out for <Skeleton> (or anything else) at the same JSX position
   * unmounts this container — and the real YT iframe with it. useYouTubePlayer's effect never
   * reruns for a same-video replay, so `player` (React state) keeps referencing this same
   * instance regardless; its postMessage-based commands then silently go nowhere, exactly like a
   * detached real iframe (confirmed against real Chrome — see WatchPage.tsx's isLoading comment,
   * planner review round 4). Modelled here so this suite can actually catch a regression of that
   * fix, not just the separate "seekTo alone is a no-op on ENDED" behavior. */
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
    // Real YouTube: seekTo() alone is a silent no-op once ENDED (below); the seek only actually
    // takes effect once playVideo() unsticks the player. Modelled here so a regression of the
    // "seekTo then playVideo, same synchronous pass" fix fails this test, not just a regression
    // of the reloadingInPlace/isLoading fix.
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
  createSessionMock.mockResolvedValueOnce(ENDED_SESSION).mockResolvedValueOnce(REPLAY_SESSION);
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

function timeLabelText(): string {
  const el = Array.from(container.querySelectorAll("span")).find((s) => s.className.includes("tabular-nums") && s.textContent?.includes("/"));
  if (!el) throw new Error("time label not rendered");
  return el.textContent ?? "";
}

function toggleButton(): HTMLButtonElement {
  const matches = Array.from(container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${copy.controlBar.pauseAriaLabel}"], button[aria-label="${copy.controlBar.playAriaLabel}"]`));
  const btn = matches[matches.length - 1];
  if (!btn) throw new Error("toggle button not rendered");
  return btn;
}

describe("WatchPage: in-app replay (no reload) restarts from 0 (planner review, must fail on 85f71dd)", () => {
  it("end -> claim -> replay -> label 0:00 -> Play -> PLAY sent and playback advances -> reaches the quiz gate", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush(); // getMe + createSession(#1, ENDED) -> SESSION_LOADED (status "claiming")
    await flush(); // useYouTubePlayer effect starts, ReplayTestPlayer constructed
    await flush(); // onReady fires -> player set; auto-claim effect fires -> postClaim -> CLAIM_ACCEPTED
    await flush(); // status "rewarded"

    const player = ReplayTestPlayer.instances[0];
    expect(player, "ReplayTestPlayer must have been constructed").toBeTruthy();
    // Not exact equality: the always-seek fix now also seeks/plays on the very first ENDED
    // session load (positionSec === DURATION_SEC already) — a harmless swallowed play-then-pause
    // round trip that can drift by a sub-millisecond real gap, not a stale/frozen value.
    expect(player.getCurrentTime(), "sanity: the reused player starts already at the end").toBeCloseTo(DURATION_SEC, 1);

    const rewatchButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === copy.rewardCard.rewatch);
    expect(rewatchButton, "the reward card's rewatch button must be present").toBeTruthy();

    act(() => rewatchButton!.click()); // handleReplay: dispatch(REPLAY_REQUESTED) + loadSession()
    await flush(); // createSession(#2, REPLAY) resolves -> SESSION_LOADED (status "ready", pendingSeekTo=0)
    await flush(); // pendingSeekTo effect: armAutoplayGuard() + player.seekTo(0, true) — SAME player instance, no remount
    await flush();

    expect(ReplayTestPlayer.instances, "the SAME player instance must be reused, not recreated (no reload happened)").toHaveLength(1);
    expect(player.seekToCallCount, "the reused player must have been seeked back to 0").toBeGreaterThan(0);
    expect(player.getCurrentTime(), "the player's own position must be back at 0").toBeCloseTo(0, 1);
    expect(timeLabelText(), "the time label must read 0:00, not the stale 0:44").toBe(`${formatTime(0)} / ${formatTime(DURATION_SEC)}`);

    const btn = toggleButton();
    expect(btn.disabled, "the toggle button must be enabled after the replay reset").toBe(false);
    act(() => btn.click()); // the user's real Play tap
    await flush();

    expect(player.playVideoCallCount, "playVideo() must actually have been called").toBeGreaterThan(0);
    expect(player.getPlayerState(), "the player must genuinely be PLAYING, not stuck").toBe(YT_PLAYER_STATE.PLAYING);

    await wait(150);
    const midPosition = player.getCurrentTime();
    expect(midPosition, "playback must be advancing forward from 0, not stuck at the old ended position").toBeGreaterThan(0);
    expect(midPosition, "must not have snapped back to the old 44s position").toBeLessThan(DURATION_SEC);

    // Reach the quiz gate (triggerSec 13) — at 8x speed, ~1.6s of real playback covers it.
    await wait(1_700);

    const choiceButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("choice-a-text"));
    expect(choiceButton, "the quiz gate must fire again on the fresh replay session, opening the modal").toBeTruthy();
  }, 20_000);
});
