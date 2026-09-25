// @vitest-environment jsdom
//
// An honest viewer answered a quiz correctly, then backgrounded
// the tab for a moment (a real, ordinary thing to do) before the 900ms auto-resume timer fired —
// and used to lose 30s of TICKs entirely (zero TICKs while the video visibly kept playing to the
// end, furthest stuck at the quiz trigger).
//
// Root cause: the TAB_HIDDEN handler called player.pauseVideo() unconditionally, even while
// state.status was still "quiz_open" (not "playing" yet — the 900ms auto-resume hadn't fired).
// The reducer's own TAB_HIDDEN case already no-ops in that case (guarded on status === "playing"),
// but the REAL pauseVideo() call still went out. When the auto-resume's own, later playVideo()
// call then produced a genuine PLAYING confirmation, that earlier, now-stale PAUSED event could
// arrive AFTER it (both are real, independently-async postMessage round trips) — and
// PAUSE_CLICKED's own guard (only "status !== playing", no staleness check) would flip status
// back to "paused" with no real pause ever issued for that specific moment. useWatchTracker's rAF
// loop only runs while active === (status === "playing"), so it silently stopped while the real
// YouTube player kept right on playing regardless of what the reducer now believed.
//
// This renders the REAL WatchPage against the REAL (unmocked) useWatchTracker/WatchTracker —
// same approach as watch-page-pause-resume-drift.test.tsx — and replays the exact sequence:
// wrong x3, correct, tab hidden -> visible before the 900ms auto-resume, play to the end.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const DURATION_SEC = 8;
const TRIGGER_SEC = 1;
const VIDEO = { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: DURATION_SEC, rewardPoints: 50 };
const QUIZ = {
  id: "q1",
  triggerSec: TRIGGER_SEC,
  prompt: "คำถามทดสอบ",
  choices: [
    { label: "A", text: "choice-a-text" },
    { label: "B", text: "choice-b-text" },
    { label: "C", text: "choice-c-text" },
    { label: "D", text: "choice-d-text" },
  ],
};
const CORRECT_LABEL = "D";

const ME_RESPONSE: MeResponse = { totalPoints: 0, rewardedVideoIds: [] };
// Starts already at the quiz gate (matches a session resumed right at the trigger) — sidesteps
// needing to reach it via real rAF-driven playback tracking first; this test is specifically about
// what happens to the tracker loop AFTER answering.
const SESSION_RESPONSE: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "QUIZ_PENDING",
  positionSec: TRIGGER_SEC,
  furthestSec: TRIGGER_SEC,
  lastSeq: 3,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: QUIZ.id,
  passedQuestionIds: [],
  video: VIDEO,
  quizzes: [QUIZ],
};

let serverFurthest = 0;
let seq = 0;
let questionPassed = false; // set once postAnswer accepts the correct choice
const postEventsCalls: Array<{ seq: number; type: ClientEventType; positionSec: number }> = [];

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => Promise.resolve(SESSION_RESPONSE),
    postAnswer: (_sessionId: string, _questionId: string, choice: string): Promise<AnswerResponse> => {
      const correct = choice === CORRECT_LABEL;
      if (correct) questionPassed = true;
      return Promise.resolve({ correct, state: "QUIZ_PENDING" });
    },
    postClaim: () => Promise.resolve({ awarded: true, points: 50, totalPoints: 50 }),
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      postEventsCalls.push(...events);
      const last = events[events.length - 1];
      serverFurthest = Math.max(serverFurthest, last.positionSec);
      seq += 1;
      // A real server only ever gates on the question once — a later PAUSE at/past the same
      // position (e.g. from the swallow-guard, or a real user re-pausing) must not re-open it.
      const gateHit = last.type === "PAUSE" && last.positionSec >= QUIZ.triggerSec && !questionPassed;
      const state = gateHit ? "QUIZ_PENDING" : last.type === "PAUSE" ? "PAUSED" : last.type === "ENDED" ? "ENDED" : "PLAYING";
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

/** Real wall-clock playback (1x) — TICKs are queued every ~1s of real time by the real
 * useWatchTracker loop and only actually sent on the next flush (a later sendImmediate, or the
 * periodic 5s interval); this test lets the flow run naturally to a real ENDED, whose own
 * sendImmediate("ENDED", ...) flushes whatever TICKs queued in between. */
class RealtimePlayer {
  static instances: RealtimePlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private baseTime = 0;
  private segmentStartMs: number | null = null;

  constructor(container: HTMLElement, opts: { events: typeof RealtimePlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    RealtimePlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime(): number {
    if (this.segmentStartMs === null) return this.baseTime;
    return this.baseTime + (performance.now() - this.segmentStartMs) / 1000;
  }

  // PLAYING fires synchronously (matching the rest of this suite's fake players) — delaying it
  // too, even briefly, was tried and broke useWatchTracker's rAF loop outright in this harness
  // (every render tears its effect down before requestAnimationFrame's callback gets a chance to
  // fire — the writer object useSessionWriter returns isn't memoized, so any effect keyed on it
  // reruns on every render; a delayed PLAYING means WatchPage keeps re-rendering across more
  // render/timer turns while the loop tries to start). Only pauseVideo() below needs to be
  // deliberately late, and it's the one call whose own confirmation actually needs to race.
  playVideo() {
    this.segmentStartMs = performance.now();
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }

  pauseVideo() {
    this.baseTime = this.getCurrentTime();
    this.segmentStartMs = null;
    // Deliberately slower than the 900ms auto-resume gap: a pauseVideo() issued just before the
    // correct answer's auto-resume timer starts reliably lands its PAUSED confirmation AFTER the
    // resume's own (synchronous, fast) PLAYING one — the exact ordering dev.db's evidence implies
    // for the TAB_HIDDEN handler's real, independently-async postMessage round trip.
    setTimeout(() => this.events.onStateChange({ data: YT_PLAYER_STATE.PAUSED }), 1000);
  }

  seekTo(seconds: number) {
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

  /** Drives it forward, firing a real ENDED once it reaches the video's duration — mirrors what
   * the real IFrame API does on its own during genuine playback. */
  tickTowardEnd() {
    if (this.segmentStartMs !== null && this.getCurrentTime() >= DURATION_SEC) {
      this.baseTime = DURATION_SEC;
      this.segmentStartMs = null;
      this.events.onStateChange({ data: YT_PLAYER_STATE.ENDED });
    }
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { YT: unknown }).YT = { Player: RealtimePlayer };
  RealtimePlayer.instances = [];
  serverFurthest = 0;
  seq = 0;
  questionPassed = false;
  postEventsCalls.length = 0;
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

function hideTab() {
  act(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function showTab() {
  act(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function findChoiceButton(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`choice button "${text}" not rendered`);
  return btn;
}

describe("WatchPage: TAB_HIDDEN during the quiz auto-resume window", () => {
  it("wrong x3 -> correct -> tab hidden/visible before the 900ms auto-resume -> TICKs keep flowing -> reaches ENDED -> claims", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const player = RealtimePlayer.instances[0];
    expect(player, "RealtimePlayer must have been constructed").toBeTruthy();
    expect(findChoiceButton("choice-a-text"), "quiz modal must already be open (session resumed at the gate)").toBeTruthy();

    // Let the mount-time resume-seek's own swallowed-play/delayed-pause settle fully (its
    // pauseVideo() shares this player's deliberately-slow 1000ms PAUSED confirmation) before
    // starting the actual scenario below — otherwise its confirmation can coincidentally land in
    // the same window as the auto-resume's, muddying which pauseVideo() call is being observed.
    await wait(1_100);
    await flush();

    // Wrong x3, then correct — the exact production sequence.
    act(() => findChoiceButton("choice-a-text").click());
    await flush();
    act(() => findChoiceButton("choice-b-text").click());
    await flush();
    act(() => findChoiceButton("choice-c-text").click());
    await flush();
    act(() => findChoiceButton("choice-d-text").click()); // correct
    await flush();

    // Tab hidden, then visible again, BEFORE the 900ms auto-resume timer fires — the exact
    // production race. Real gap well under 900ms.
    hideTab();
    await flush();
    showTab();
    await flush();

    // Let the 900ms auto-resume timer fire and settle.
    await wait(1_100);
    await flush();

    // The resume must have produced a genuine, confirmed PLAY — this alone doesn't yet prove the
    // tracker loop survived, just that the initial resume wasn't itself swallowed/lost.
    expect(postEventsCalls.some((e) => e.type === "PLAY"), "the auto-resume's PLAY must have been sent").toBe(true);

    // Drive the fake player forward in real time toward the end, exactly like a real, unattended
    // honest playthrough — if the tracker loop silently stopped, nothing
    // here queues or sends any TICKs, and furthestSec would stay stuck at TRIGGER_SEC.
    const driveInterval = setInterval(() => player.tickTowardEnd(), 50);
    try {
      await wait((DURATION_SEC - TRIGGER_SEC + 1) * 1000);
      await flush();
    } finally {
      clearInterval(driveInterval);
    }

    const ticksAfterResume = postEventsCalls.filter((e) => e.type === "TICK" && e.positionSec > TRIGGER_SEC + 0.5);
    expect(ticksAfterResume.length, "TICKs must have kept flowing after the resume, not stuck at the gate position").toBeGreaterThan(0);

    expect(postEventsCalls.some((e) => e.type === "ENDED"), "the real ENDED transition must have been sent").toBe(true);

    // Auto-claim.
    await wait(200);
    await flush();
    expect(container.textContent, "the reward must have been claimed").toContain("50");
  }, 20_000);
});
