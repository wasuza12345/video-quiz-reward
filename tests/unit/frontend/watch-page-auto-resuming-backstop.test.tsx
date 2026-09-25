// @vitest-environment jsdom
//
// autoResuming (WatchPage's own state, not a YouTube quirk) is set true the instant the quiz
// auto-resume timer fires and must come back to false once the player actually confirms PLAYING.
// If player.play() never yields a PLAYING confirmation at all — e.g. iOS/Safari silently blocking
// playback that lacks a user gesture — the Play/Pause control would stay disabled forever with no
// way for the user to recover. This test exercises WatchPage's own ~3s backstop timer that clears
// autoResuming in that case. Renders the real WatchPage against a fake YT.Player with
// api/router/tracker mocked out, and a jsdom <dialog> polyfill (jsdom has no showModal()/close())
// for QuizModal.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";
import { YT_PLAYER_STATE } from "@/frontend/public/hooks/useYouTubePlayer";

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

vi.mock("@/frontend/public/services/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getMe: () => Promise.resolve(ME_RESPONSE),
    createSession: () => Promise.resolve(SESSION_RESPONSE),
    postAnswer: () => Promise.resolve(ANSWER_RESPONSE),
    postEvents: () =>
      Promise.resolve({ state: "PLAYING", positionSec: 10, furthestSec: 10, lastSeq: 3, currentQuestionId: null, results: [], remainingWatchSec: 0 }),
    postClaim: () => Promise.resolve({ awarded: false, points: 0, totalPoints: 0 }),
  },
}));

class FakePlayer {
  // Simulates a playVideo() call that never actually yields PLAYING — e.g. iOS/Safari silently
  // blocking playback that lacks a user gesture.
  static playVideoFiresPlaying = false;
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
    if (FakePlayer.playVideoFiresPlaying) this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
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
  FakePlayer.playVideoFiresPlaying = false;
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
  // jsdom implements <dialog> as a plain element with no showModal()/close() — Modal.tsx (a native
  // <dialog>) needs at least a no-crash stub to render QuizModal at all.
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

function toggleButtonDisabled(): boolean {
  const matches = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="หยุดชั่วคราว"], button[aria-label="เล่นวิดีโอ"]'));
  const btn = matches[matches.length - 1];
  return btn ? btn.disabled : true;
}

describe("WatchPage: autoResuming ~3s backstop", () => {
  it("re-enables Play if the quiz auto-resume's play() never yields PLAYING", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush();
    await flush();
    await flush();

    const choiceButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("choice-b-text"));
    expect(choiceButton, "quiz modal choice button must be present once quiz_open loads").toBeTruthy();
    act(() => choiceButton!.click());
    await flush(); // sendAnswer resolves -> ANSWER_ACCEPTED (feedback.tone = "correct")

    await new Promise((resolve) => setTimeout(resolve, 950));
    await flush(); // QUIZ_RESUME_AFTER_CORRECT -> setAutoResuming(true) -> play() (no PLAYING this time)

    expect(toggleButtonDisabled(), "autoResuming must be true right after the failed auto-resume play").toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 3100));
    await flush(); // the ~3s backstop clears autoResuming

    expect(toggleButtonDisabled(), "the backstop must clear autoResuming so the user can tap Play themselves").toBe(false);
  }, 15_000);
});
