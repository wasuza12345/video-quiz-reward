// @vitest-environment jsdom
//
// The 900ms auto-resume after a correct answer used to call
// player.playVideo() unconditionally, even if the tab was hidden by the time the timer fired. A
// hidden tab never gets rAF ticks (browsers throttle/stop them), so this silently started real
// playback (and real server-side progress) the viewer couldn't see or pause — and useWatchTracker's
// TICK loop, gated on status === "playing", would have nothing to show for it once the tab came
// back except a video that had been playing unseen the whole time.
//
// Fix: the 900ms timer checks document.visibilityState right when it fires. If hidden, it skips
// setAutoResuming/armAutoResumingBackstop/player.playVideo() entirely and leaves status "paused"
// (the still-dispatched QUIZ_RESUME_AFTER_CORRECT is tagged hidden:true, so pausedByTabHidden is
// also set and the "you left the tab" notice shows) — the user resumes with an
// explicit tap once they come back, exactly like any other paused video.
//
// This renders the REAL WatchPage (unmocked reducer/effects) and replays: wrong x3 -> correct D ->
// tab hidden BEFORE the 900ms timer fires -> stays hidden past it -> nothing auto-plays -> tab
// visible again -> still nothing auto-plays -> an explicit Play tap resumes for real.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, EventsApplyResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClientEventType } from "@/shared/constants/session";
import { YT_PLAYER_STATE } from "@/frontend/public/player/youtube-player-types";
import { watch as copy } from "@/frontend/public/constants/copy.th";

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
// Starts already at the quiz gate, matching a session resumed right at the trigger — sidesteps
// needing real rAF-driven playback to reach it first, which isn't the point of this test.
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

let serverFurthest = TRIGGER_SEC;
let seq = 0;
let questionPassed = false;
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
    postClaim: () => Promise.reject(new Error("not used in this test")),
    postEvents: (_sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number }>): Promise<EventsApplyResponse> => {
      postEventsCalls.push(...events);
      const last = events[events.length - 1];
      serverFurthest = Math.max(serverFurthest, last.positionSec);
      seq += 1;
      const gateHit = last.type === "PAUSE" && last.positionSec >= QUIZ.triggerSec && !questionPassed;
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

/** Just tracks calls — this test is about whether playVideo() gets called at all while hidden,
 * not about real elapsed playback. */
class TrackingPlayer {
  static instances: TrackingPlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private time = TRIGGER_SEC;
  playVideoCallCount = 0;
  pauseVideoCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof TrackingPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    TrackingPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime() {
    return this.time;
  }
  playVideo() {
    this.playVideoCallCount += 1;
    this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }
  pauseVideo() {
    this.pauseVideoCallCount += 1;
    this.events.onStateChange({ data: YT_PLAYER_STATE.PAUSED });
  }
  seekTo(seconds: number) {
    this.time = seconds;
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
  (window as unknown as { YT: unknown }).YT = { Player: TrackingPlayer };
  TrackingPlayer.instances = [];
  serverFurthest = TRIGGER_SEC;
  seq = 0;
  questionPassed = false;
  postEventsCalls.length = 0;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
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

function playButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${copy.controlBar.playAriaLabel}"]`);
}

describe("WatchPage: hidden tab skips the 900ms quiz auto-resume", () => {
  it("tab hidden through the whole 900ms window: never calls playVideo(), stays paused, resumes only on an explicit tap", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const player = TrackingPlayer.instances[0];
    expect(player, "TrackingPlayer must have been constructed").toBeTruthy();
    expect(findChoiceButton("choice-a-text"), "quiz modal must already be open (session resumed at the gate)").toBeTruthy();

    act(() => findChoiceButton("choice-a-text").click()); // wrong
    await flush();
    act(() => findChoiceButton("choice-b-text").click()); // wrong
    await flush();
    act(() => findChoiceButton("choice-c-text").click()); // wrong
    await flush();
    act(() => findChoiceButton("choice-d-text").click()); // correct
    await flush();

    const playVideoCallsBeforeHide = player.playVideoCallCount;

    // Hide well before the 900ms auto-resume timer fires, and stay hidden through it.
    hideTab();
    await flush();
    await wait(1_100);
    await flush();

    expect(player.playVideoCallCount, "playVideo() must never be called while the tab is hidden").toBe(playVideoCallsBeforeHide);
    expect(postEventsCalls.some((e) => e.type === "PLAY"), "no PLAY event must have been sent while hidden").toBe(false);
    expect(playButton(), "the Play button must be showing — status must have landed on paused, not playing").toBeTruthy();
    expect(container.textContent, "the 'paused because you left the tab' notice must show").toContain(copy.statusLine.pausedTabHidden);

    // Coming back into view must not auto-play either — the fix leaves this an explicit user
    // action, not something that silently resumed off-screen.
    showTab();
    await flush();
    await wait(200);
    await flush();

    expect(player.playVideoCallCount, "becoming visible again must not itself trigger playVideo()").toBe(playVideoCallsBeforeHide);
    expect(postEventsCalls.some((e) => e.type === "PLAY"), "still no PLAY event without an explicit tap").toBe(false);

    // An explicit tap resumes for real.
    const btn = playButton();
    expect(btn, "Play button must still be there to tap").toBeTruthy();
    act(() => btn!.click());
    await flush();

    expect(player.playVideoCallCount, "the explicit tap must call playVideo() for real").toBe(playVideoCallsBeforeHide + 1);
    expect(postEventsCalls.some((e) => e.type === "PLAY"), "the explicit tap must send a real PLAY event").toBe(true);
  }, 15_000);
});
