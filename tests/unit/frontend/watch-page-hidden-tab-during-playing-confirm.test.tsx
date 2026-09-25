// @vitest-environment jsdom
//
// The quiz auto-resume's player.playVideo() call and
// the real player's own onStateChange(PLAYING) confirmation are independently-async (a real
// postMessage round trip, same as every other player call in this suite) — nothing orders them.
// If the tab is backgrounded in that gap (after playVideo() fires but before PLAYING lands),
// state.status was still "paused"/"quiz_open" the whole time, so the separate visibilitychange
// listener's own status==="playing" guard never caught it — the real player kept playing in the
// background, unseen and unreported, until the user came back.
//
// Fix: the PLAYING handler itself now checks document.visibilityState. If hidden when the
// confirmation lands, it pauses and sends TAB_HIDDEN instead of accepting the PLAY.
//
// This renders the REAL WatchPage and replays: wrong x3 -> correct D -> the 900ms timer fires
// while visible (so playVideo() IS called) -> tab hidden in the real gap before the player's own
// delayed PLAYING confirmation arrives -> confirmation lands while hidden.
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
      const state = gateHit ? "QUIZ_PENDING" : last.type === "PAUSE" || last.type === "TAB_HIDDEN" ? "PAUSED" : "PLAYING";
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

const PLAYING_CONFIRM_DELAY_MS = 500;

/** playVideo()'s own PLAYING confirmation is deliberately delayed (a real, independently-async
 * postMessage round trip, same as documented elsewhere in this suite) — long enough for the test
 * to hide the tab in the real gap between the call and the confirmation landing. */
class DelayedConfirmPlayer {
  static instances: DelayedConfirmPlayer[] = [];
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };
  private time = TRIGGER_SEC;
  playVideoCallCount = 0;
  pauseVideoCallCount = 0;

  constructor(container: HTMLElement, opts: { events: typeof DelayedConfirmPlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    DelayedConfirmPlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  getCurrentTime() {
    return this.time;
  }
  playVideo() {
    this.playVideoCallCount += 1;
    setTimeout(() => this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING }), PLAYING_CONFIRM_DELAY_MS);
  }
  pauseVideo() {
    this.pauseVideoCallCount += 1;
    // Deliberately async (a real postMessage round trip, same as playVideo() above) — a
    // synchronous confirmation here would let the fix's own player.pauseVideo() call reenter
    // handleStateChangeRef synchronously, sending PAUSE and marking the writer in-flight before
    // the fix's own TAB_HIDDEN send runs — an artifact only a too-synchronous mock could produce,
    // since real pauseVideo() can never confirm before the calling code continues past the line.
    setTimeout(() => this.events.onStateChange({ data: YT_PLAYER_STATE.PAUSED }), 50);
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
  (window as unknown as { YT: unknown }).YT = { Player: DelayedConfirmPlayer };
  DelayedConfirmPlayer.instances = [];
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

function findChoiceButton(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`choice button "${text}" not rendered`);
  return btn;
}

function playButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${copy.controlBar.playAriaLabel}"]`);
}

describe("WatchPage: hidden tab during the auto-resume's own PLAYING confirmation", () => {
  it("tab hidden after playVideo() but before PLAYING lands: the late confirmation is paused and reported, never accepted as real playback", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const player = DelayedConfirmPlayer.instances[0];
    expect(player, "DelayedConfirmPlayer must have been constructed").toBeTruthy();
    expect(findChoiceButton("choice-a-text"), "quiz modal must already be open (session resumed at the gate)").toBeTruthy();

    act(() => findChoiceButton("choice-a-text").click()); // wrong
    await flush();
    act(() => findChoiceButton("choice-b-text").click()); // wrong
    await flush();
    act(() => findChoiceButton("choice-c-text").click()); // wrong
    await flush();
    act(() => findChoiceButton("choice-d-text").click()); // correct
    await flush();

    // Let the 900ms auto-resume timer fire WHILE VISIBLE — playVideo() is called for real, and its
    // own PLAYING confirmation is now scheduled PLAYING_CONFIRM_DELAY_MS out.
    await wait(1_000);
    await flush();
    expect(player.playVideoCallCount, "the visible auto-resume must have called playVideo()").toBe(1);

    // Hide right in the real gap between the call and its confirmation landing.
    hideTab();
    await flush();

    // Let the delayed PLAYING confirmation actually arrive, still hidden.
    await wait(PLAYING_CONFIRM_DELAY_MS + 200);
    await flush();

    expect(player.pauseVideoCallCount, "the late PLAYING confirmation must have been paused once caught, not accepted").toBeGreaterThanOrEqual(1);
    expect(postEventsCalls.some((e) => e.type === "PLAY"), "no PLAY event must ever have been sent — the confirmation landed while hidden").toBe(false);
    expect(postEventsCalls.some((e) => e.type === "TAB_HIDDEN"), "a TAB_HIDDEN event must have been reported instead").toBe(true);
    expect(playButton(), "status must have landed on paused, not playing, in background").toBeTruthy();
  }, 15_000);
});
