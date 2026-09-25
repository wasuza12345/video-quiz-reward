// @vitest-environment jsdom
//
// MAJOR (clean-code, #12 fixup): the machine keeps the quiz modal open through the whole 900ms
// "correct" step (phase.kind "quiz", step "correct") — matching spec, but unlike the old reducer,
// which nulled currentQuestionId on a correct answer and closed the modal outright. QuizModal's
// own disabled check and WatchPage's handleChoice must both reject a tap during that window: a
// second tap that reaches the server gets NOT_AT_QUIZ back (the session already moved past the
// gate), which used to dispatch ANSWER_FAILED -> phase "paused" with a gateFallback toast,
// cancelling the pending auto-resume entirely. Must fail on ffddb23.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

vi.mock("@/frontend/public/hooks/useWatchTracker", () => ({
  useWatchTracker: () => ({ isGateInFlight: () => false, getMaxReached: () => 0, noteSettled: () => {} }),
}));

const ME_RESPONSE: MeResponse = { totalPoints: 0, rewardedVideoIds: [] };
const SESSION_RESPONSE: SessionCreateResponse = {
  sessionId: "sess-1",
  state: "QUIZ_PENDING",
  positionSec: 10,
  furthestSec: 10,
  lastSeq: 3,
  isReplay: false,
  alreadyRewarded: false,
  currentQuestionId: "q1",
  passedQuestionIds: [],
  video: { id: "v1", youtubeId: "X7K_Xlz3T1Y", title: "Test video", channelName: "Channel", durationSec: 44, rewardPoints: 50 },
  quizzes: [
    {
      id: "q1",
      triggerSec: 13,
      prompt: "คำถามทดสอบ",
      choices: [
        { label: "A", text: "choice-a-text" },
        { label: "B", text: "choice-b-text" },
      ],
    },
  ],
};
const ANSWER_RESPONSE: AnswerResponse = { correct: true, state: "QUIZ_PENDING" };
const postAnswerMock = vi.fn(() => Promise.resolve(ANSWER_RESPONSE));

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => Promise.resolve(SESSION_RESPONSE),
    postAnswer: (...args: unknown[]) => postAnswerMock(...(args as [])),
    postEvents: () =>
      Promise.resolve({ state: "PLAYING", positionSec: 10, furthestSec: 10, lastSeq: 3, currentQuestionId: null, results: [], remainingWatchSec: 0 }),
    postClaim: () => Promise.resolve({ awarded: false, points: 0, totalPoints: 0 }),
  },
}));

class FakePlayer {
  static instances: FakePlayer[] = [];
  playVideoCallCount = 0;
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };

  constructor(container: HTMLElement, opts: { events: typeof FakePlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    FakePlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  seekTo() {}
  playVideo() {
    this.playVideoCallCount += 1;
  }
  pauseVideo() {}
  getCurrentTime() {
    return 10;
  }
  getPlayerState() {
    return 2;
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
  FakePlayer.instances = [];
  postAnswerMock.mockClear();
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
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

function toastText(): string | null {
  // The only role="status" element in this quiz-only scenario is the Toast (rendered while
  // useToast's `visible` is truthy) — RewardCard, the other role="status" in the tree, never
  // mounts here since the session never reaches "rewarded".
  const el = container.querySelector('div[role="status"]');
  return el?.textContent ?? null;
}

describe("WatchPage: a second tap during the 900ms post-correct-answer window is a no-op", () => {
  it("sendAnswer is called exactly once, no gateFallback toast appears, and the auto-resume play() still fires", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const choiceButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("choice-b-text"));
    expect(choiceButton(), "quiz modal choice button must be present once quiz_open loads").toBeTruthy();
    act(() => choiceButton()!.click());
    await flush(); // sendAnswer resolves -> ANSWER_ACCEPTED (step "correct", feedback.tone "correct")

    expect(postAnswerMock, "the first, real answer must have been sent").toHaveBeenCalledTimes(1);

    // A second tap during the "correct" window — the choice button, if still rendered, must now
    // be disabled (QuizModal's own guard), and even a direct call would be rejected by
    // handleChoice's own phase.step==="answering" guard.
    const secondTap = choiceButton();
    if (secondTap) act(() => secondTap.click());
    await flush();

    expect(postAnswerMock, "a second tap during the correct window must not send a second /answer").toHaveBeenCalledTimes(1);
    expect(toastText(), "no gateFallback (or any) toast should appear from a rejected second tap").toBeNull();

    // The 900ms auto-resume timer must still fire normally — a wrongly-dispatched ANSWER_FAILED
    // would have moved phase to "paused" and cancelled it.
    await new Promise((resolve) => setTimeout(resolve, 950));
    await flush();

    const player = FakePlayer.instances[0];
    expect(player.playVideoCallCount, "the auto-resume's own play() must still fire").toBeGreaterThan(0);
  }, 15_000);
});
