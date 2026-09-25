// @vitest-environment jsdom
//
// Planner review follow-up on the "refresh disables Play forever" fix: the seek guard armed by a
// non-autoplaying seek (the common case — an already-buffered player, e.g. a TICK-overshoot clamp
// while paused/quiz_open) must not outlive that seek and swallow a LATER, legitimate play — here,
// the quiz auto-resume after a correct answer — which would otherwise leave autoResuming stuck
// true and the Play/Pause control permanently disabled. Renders the real WatchPage against a fake
// YT.Player (same approach as use-youtube-player-lifecycle.test.tsx) with api/router/tracker
// mocked out, and a jsdom <dialog> polyfill (jsdom has no showModal()/close()) for QuizModal.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerResponse, SessionCreateResponse } from "@/shared/contracts/session";
import type { MeResponse } from "@/shared/contracts/video";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

vi.mock("@/frontend/public/hooks/useWatchTracker", () => ({
  useWatchTracker: () => ({ isGateInFlight: () => false }),
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
    // "PLAYING" here (not "QUIZ_PENDING"): a real server would report the state that actually
    // results from the PLAY event this writes. A stale "QUIZ_PENDING" would (correctly, per
    // watch.reducer.ts's EVENTS_SYNCED case) resync status back to quiz_open — a mock bug that
    // looks exactly like the swallowed-play defect this test exists to catch, and did in an
    // earlier draft of this test.
    postEvents: () => Promise.resolve({ state: "PLAYING", positionSec: 10, furthestSec: 10, lastSeq: 3, currentQuestionId: null, results: [] }),
    postClaim: () => Promise.resolve({ awarded: false, points: 0, totalPoints: 0 }),
  },
}));

class FakePlayer {
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };

  constructor(container: HTMLElement, opts: { events: typeof FakePlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  // The scenario under test: seekTo() alone does NOT auto-play (an already-buffered, non-cued
  // player — unlike the fresh-embed case the first fix targeted). Only an explicit playVideo()
  // call transitions the player to PLAYING here.
  seekTo() {}
  playVideo() {
    this.events.onStateChange({ data: 1 /* YT_PLAYER_STATE.PLAYING */ });
  }
  // Deliberately does NOT fire onStateChange(PAUSED): the real YT IFrame API reports state changes
  // asynchronously (postMessage), so a pauseVideo() call must never be relied on to synchronously
  // "rescue" autoResuming via the separate PAUSED handler — that would mask exactly the swallowed-
  // play defect this test exists to catch.
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
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
  // jsdom implements <dialog> as a plain element with no showModal()/close() — Modal.tsx (a native
  // <dialog>) needs at least a no-crash stub to render QuizModal at all. Unconditional: this suite
  // only ever runs under jsdom, which never actually implements these.
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

function pauseButtonDisabled(): boolean {
  const matches = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="หยุดชั่วคราว"]'));
  // Two elements can share this label (VideoPlayer's always-enabled click-shield, ControlBar's
  // real button) — ControlBar's own renders after VideoPlayer's, same convention the real E2E
  // helper (tests/e2e/browser/helpers/watch.ts) uses.
  const btn = matches[matches.length - 1];
  return btn ? btn.disabled : true;
}

describe("WatchPage autoplay guard one-shot behaviour (planner follow-up review)", () => {
  it("a non-autoplaying seek's guard does not swallow the later quiz auto-resume play", async () => {
    const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
    act(() => root.render(<WatchPage videoId="v1" />));
    await flush(); // getMe + createSession resolve -> SESSION_LOADED (status "quiz_open", pendingSeekTo=10)
    await flush(); // useYouTubePlayer effect starts, loadYouTubeIframeApi resolves, FakePlayer constructed
    await flush(); // onReady fires -> player set -> pendingSeekTo effect arms the guard and seeks (no autoplay)

    const choiceButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("choice-b-text"));
    expect(choiceButton, "quiz modal choice button must be present once quiz_open loads").toBeTruthy();
    act(() => choiceButton!.click());
    await flush(); // sendAnswer resolves -> ANSWER_ACCEPTED (feedback.tone = "correct")

    // The 900ms auto-resume timer is real (not faked) — this is the one genuinely slow test in
    // the suite; keeping it as a real timer avoids fake-timer/promise-microtask ordering pitfalls
    // in an already-complex integration test.
    await new Promise((resolve) => setTimeout(resolve, 950));
    await flush(); // QUIZ_RESUME_AFTER_CORRECT -> clearAutoplayGuard() -> playVideo() -> PLAYING -> PLAY_CLICKED
    await flush(); // writer.sendImmediate("PLAY") -> EVENTS_SYNCED

    expect(pauseButtonDisabled(), "autoResuming must be back to false: the real auto-resume play must not have been swallowed").toBe(false);
  }, 15_000);
});
