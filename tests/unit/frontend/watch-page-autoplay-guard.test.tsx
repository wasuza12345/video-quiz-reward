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
import { YT_PLAYER_STATE } from "@/frontend/public/hooks/useYouTubePlayer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

vi.mock("@/frontend/public/hooks/useWatchTracker", () => ({
  useWatchTracker: () => ({ isGateInFlight: () => false, getMaxReached: () => 0 }),
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
  // Reset in beforeEach. Lets a single test (the autoResuming-backstop one) simulate a
  // playVideo() call that never actually yields PLAYING — e.g. iOS/Safari silently blocking
  // playback that lacks a user gesture — without needing a second FakePlayer implementation.
  static playVideoFiresPlaying = true;
  static instances: FakePlayer[] = [];

  playVideoCallCount = 0;
  pauseVideoCallCount = 0;
  private container: HTMLElement;
  private events: { onReady: () => void; onStateChange: (e: { data: number }) => void };

  constructor(container: HTMLElement, opts: { events: typeof FakePlayer.prototype.events }) {
    this.container = container;
    this.events = opts.events;
    FakePlayer.instances.push(this);
    container.appendChild(document.createElement("iframe"));
    queueMicrotask(() => this.events.onReady());
  }

  /** Lets a test simulate a state change the real IFrame API would report asynchronously —
   * either the seek quirk's own spurious PLAYING, or an intermediate BUFFERING/UNSTARTED tick. */
  fireStateChange(data: number) {
    this.events.onStateChange({ data });
  }

  // The scenario under test: seekTo() alone does NOT auto-play (an already-buffered, non-cued
  // player — unlike the fresh-embed case the first fix targeted). Only an explicit playVideo()
  // call transitions the player to PLAYING here.
  seekTo() {}
  playVideo() {
    this.playVideoCallCount += 1;
    if (FakePlayer.playVideoFiresPlaying) this.events.onStateChange({ data: YT_PLAYER_STATE.PLAYING });
  }
  // Deliberately does NOT fire onStateChange(PAUSED): the real YT IFrame API reports state changes
  // asynchronously (postMessage), so a pauseVideo() call must never be relied on to synchronously
  // "rescue" autoResuming via the separate PAUSED handler — that would mask exactly the swallowed-
  // play defect this test exists to catch.
  pauseVideo() {
    this.pauseVideoCallCount += 1;
  }
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
  FakePlayer.playVideoFiresPlaying = true;
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

/** Same as pauseButtonDisabled(), but matches either aria-label. Needed whenever the video never
 * actually reaches isPlaying=true (e.g. a simulated failed auto-resume play): the toggle keeps
 * its "เล่นวิดีโอ" (Play) label the whole time, so pauseButtonDisabled()'s Pause-only selector
 * would never match anything and fall through to its "not found" default. */
function toggleButtonDisabled(): boolean {
  const matches = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label="หยุดชั่วคราว"], button[aria-label="เล่นวิดีโอ"]'));
  const btn = matches[matches.length - 1];
  return btn ? btn.disabled : true;
}

/** Mounts WatchPage and flushes through session-load/player-construction/seek — the seek is a
 * non-autoplaying one (state.status is "quiz_open", not "playing"), so it arms the guard without
 * FakePlayer ever firing a state change on its own. Returns the constructed FakePlayer instance. */
async function mountAndArmGuard(): Promise<FakePlayer> {
  const { WatchPage } = await import("@/frontend/public/pages/WatchPage");
  act(() => root.render(<WatchPage videoId="v1" />));
  await flush(); // getMe + createSession resolve -> SESSION_LOADED (status "quiz_open", pendingSeekTo=10)
  await flush(); // useYouTubePlayer effect starts, loadYouTubeIframeApi resolves, FakePlayer constructed
  await flush(); // onReady fires -> player set -> pendingSeekTo effect arms the guard and seeks (no autoplay)
  const instance = FakePlayer.instances[0];
  if (!instance) throw new Error("FakePlayer was not constructed");
  return instance;
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

  it("a spurious PLAYING while the guard is armed is swallowed: paused back, not dispatched as a real play", async () => {
    const instance = await mountAndArmGuard();

    // Simulates the seek quirk itself: a PLAYING event the app never asked for (no playVideo()
    // call preceded it).
    act(() => instance.fireStateChange(YT_PLAYER_STATE.PLAYING));
    await flush();

    // pauseVideo() is only ever called from the swallow branch in this flow — its call count is
    // the guard's own tell, independent of reducer state (PLAY_CLICKED is itself a no-op while
    // quiz_open, so a status/DOM check here couldn't distinguish swallowed from not-swallowed).
    expect(instance.pauseVideoCallCount, "a spurious PLAYING while armed must be paused straight back").toBe(1);
  }, 15_000);

  it("BUFFERING while armed does not disarm the guard: a later spurious PLAYING is still swallowed", async () => {
    const instance = await mountAndArmGuard();

    // The real quirk's own transitional tick on its way to the spurious PLAYING (observed
    // sequence: UNSTARTED -> BUFFERING -> UNSTARTED -> PLAYING) — must not disarm early.
    act(() => instance.fireStateChange(YT_PLAYER_STATE.BUFFERING));
    await flush();
    act(() => instance.fireStateChange(YT_PLAYER_STATE.PLAYING));
    await flush();

    expect(instance.pauseVideoCallCount, "BUFFERING must not have disarmed the guard").toBe(1);
  }, 15_000);

  it("the guard disarms on the first settled, non-BUFFERING state — ahead of the backstop timer", async () => {
    const instance = await mountAndArmGuard();

    // A settled state (here PAUSED — CUED/ENDED disarm the same way) reached while armed means
    // the seek's quirk isn't going to fire; the guard must let go immediately rather than wait out
    // the backstop. PAUSE_CLICKED is itself a no-op while quiz_open, so this can't accidentally
    // change state.status underneath the next assertion.
    act(() => instance.fireStateChange(YT_PLAYER_STATE.PAUSED));
    await flush();
    act(() => instance.fireStateChange(YT_PLAYER_STATE.PLAYING));
    await flush();

    expect(instance.pauseVideoCallCount, "PLAYING after a settled state must be treated as real, not swallowed").toBe(0);
  }, 15_000);

  it("the ~5s backstop disarms a guard whose seek never produces any settling event at all", async () => {
    const instance = await mountAndArmGuard();

    // The common case this whole one-shot design exists for (see the top-of-file comment): an
    // already-buffered player's seekTo() is a genuine no-op, no event ever fires on its own.
    await new Promise((resolve) => setTimeout(resolve, 5100));
    await flush();

    act(() => instance.fireStateChange(YT_PLAYER_STATE.PLAYING));
    await flush();

    expect(instance.pauseVideoCallCount, "the backstop must have disarmed the guard before this PLAYING arrived").toBe(0);
  }, 15_000);

  it("the ~3s autoResuming backstop re-enables Play if the auto-resume's playVideo() never yields PLAYING", async () => {
    FakePlayer.playVideoFiresPlaying = false; // simulates e.g. iOS/Safari blocking a gesture-less play
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
    await flush(); // QUIZ_RESUME_AFTER_CORRECT -> setAutoResuming(true) -> playVideo() (no PLAYING this time)

    expect(toggleButtonDisabled(), "autoResuming must be true right after the failed auto-resume play").toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 3100));
    await flush(); // the ~3s backstop clears autoResuming

    expect(toggleButtonDisabled(), "the backstop must clear autoResuming so the user can tap Play themselves").toBe(false);
  }, 15_000);
});
