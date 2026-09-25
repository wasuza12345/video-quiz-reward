import { describe, expect, it } from "vitest";
import { initialWatchState, watchReducer, WATCH_ERRORS, type WatchState } from "@/frontend/public/state/watch.reducer";
import type { WatchAction } from "@/frontend/public/state/watch.actions";
import type { SessionCreateResponse } from "@/shared/contracts/session";

const VIDEO = { id: "v1", youtubeId: "abc", title: "Test", channelName: "Ch", durationSec: 44, rewardPoints: 50 };
const Q1 = { id: "q1", triggerSec: 13, prompt: "?", choices: [{ label: "A", text: "a" }, { label: "D", text: "d" }] };

function session(overrides: Partial<SessionCreateResponse> = {}): SessionCreateResponse {
  return {
    sessionId: "s1",
    state: "CREATED",
    positionSec: 0,
    furthestSec: 0,
    lastSeq: 0,
    isReplay: false,
    alreadyRewarded: false,
    currentQuestionId: null,
    passedQuestionIds: [],
    video: VIDEO,
    quizzes: [Q1],
    ...overrides,
  };
}

function run(actions: WatchAction[], start: WatchState = initialWatchState): WatchState {
  return actions.reduce(watchReducer, start);
}

describe("SESSION_LOADED — derives the starting status from server state (spec §4.4 rows 2-5)", () => {
  it("row 2: CREATED, positionSec 0 → ready, no resumed banner", () => {
    const s = run([{ type: "SESSION_LOADED", session: session() }]);
    expect(s.status).toBe("ready");
    expect(s.showResumedBanner).toBe(false);
  });

  it("row 3: PAUSED with positionSec > 0 → ready, resumed banner shown", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "PAUSED", positionSec: 20, furthestSec: 20 }) }]);
    expect(s.status).toBe("ready");
    expect(s.showResumedBanner).toBe(true);
  });

  it("PAUSED with positionSec 6.9 → pendingSeekTo 6.9, so the player actually seeks to where the banner claims", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "PAUSED", positionSec: 6.9, furthestSec: 6.9 }) }]);
    expect(s.pendingSeekTo).toBe(6.9);
  });

  it("a brand new session (positionSec 0) still seeks to 0, not null (replay restarts from 0)", () => {
    // Was previously conditional on positionSec > 0, on the assumption a fresh player already
    // sits at 0 on its own — true after a real reload, false for an in-app replay of the same
    // video: useYouTubePlayer's effect never reruns, so the SAME player instance is reused, still
    // sitting at ENDED at the old duration. Without an explicit seekTo(0), Play was a silent
    // no-op (YouTube doesn't resume from ENDED without a seek first).
    const s = run([{ type: "SESSION_LOADED", session: session() }]);
    expect(s.pendingSeekTo).toBe(0);
  });

  it("a resumed QUIZ_PENDING session also seeks to its (nonzero) position, not just PAUSED", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 }) }]);
    expect(s.pendingSeekTo).toBe(13);
  });

  it("row 4: QUIZ_PENDING → quiz_open, ready phase (no syncing step)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 }) }]);
    expect(s.status).toBe("quiz_open");
    expect(s.quizPhase).toBe("ready");
  });

  it("row 5: ENDED, not rewarded → claiming (auto-claim)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "ENDED", furthestSec: 44 }) }]);
    expect(s.status).toBe("claiming");
  });

  it("isReplay or alreadyRewarded shows the replay banner (row 20)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ isReplay: true }) }]);
    expect(s.showReplayBanner).toBe(true);
  });
});

describe("play / pause / tab-hidden", () => {
  const ready = run([{ type: "SESSION_LOADED", session: session() }]);

  it("PLAY_CLICKED from ready → playing, clears banners", () => {
    const s = watchReducer({ ...ready, showResumedBanner: true }, { type: "PLAY_CLICKED" });
    expect(s.status).toBe("playing");
    expect(s.showResumedBanner).toBe(false);
  });

  it("PAUSE_CLICKED from playing → paused, not tab-hidden", () => {
    const playing = watchReducer(ready, { type: "PLAY_CLICKED" });
    const s = watchReducer(playing, { type: "PAUSE_CLICKED" });
    expect(s.status).toBe("paused");
    expect(s.pausedByTabHidden).toBe(false);
  });

  it("TAB_HIDDEN from playing → paused, pausedByTabHidden true (row 8)", () => {
    const playing = watchReducer(ready, { type: "PLAY_CLICKED" });
    const s = watchReducer(playing, { type: "TAB_HIDDEN" });
    expect(s.status).toBe("paused");
    expect(s.pausedByTabHidden).toBe(true);
  });

  it("PLAY_CLICKED is a no-op outside ready/paused", () => {
    const s = watchReducer(initialWatchState, { type: "PLAY_CLICKED" }); // status: loading
    expect(s.status).toBe("loading");
  });
});

describe("quiz gate (rows 9-12)", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("row 9: QUIZ_GATE_HIT → quiz_open, syncing", () => {
    const s = watchReducer(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    expect(s.status).toBe("quiz_open");
    expect(s.quizPhase).toBe("syncing");
    expect(s.currentQuestionId).toBe("q1");
  });

  it("row 10: gate TICK confirms QUIZ_PENDING → syncing becomes ready", () => {
    const syncing = watchReducer(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const s = watchReducer(syncing, { type: "GATE_TICK_RESULT", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    expect(s.quizPhase).toBe("ready");
  });

  it("row 12: gate TICK result isn't QUIZ_PENDING → gate fallback, resync + toast", () => {
    const syncing = watchReducer(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const s = watchReducer(syncing, { type: "GATE_TICK_RESULT", state: "PLAYING", positionSec: 11, furthestSec: 12 });
    expect(s.status).toBe("playing");
    expect(s.quizPhase).toBeNull();
    expect(s.pendingSeekTo).toBe(11);
    expect(s.toastRequest?.message).toBeTruthy();
  });

  it("a stale GATE_TICK_RESULT (already left syncing) is ignored", () => {
    const syncing = watchReducer(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const ready = watchReducer(syncing, { type: "GATE_TICK_RESULT", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    const s = watchReducer(ready, { type: "GATE_TICK_RESULT", state: "PLAYING", positionSec: 99, furthestSec: 99 });
    expect(s).toEqual(ready); // no change — quizPhase is no longer "syncing"
  });
});

describe("EVENTS_SYNCED — every accepted events response is dispatched", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("row 6: an ordinary accepted sync just advances positionSec/furthestSec, status untouched", () => {
    const s = watchReducer(playing, { type: "EVENTS_SYNCED", state: "PLAYING", positionSec: 4, furthestSec: 4, currentQuestionId: null });
    expect(s.status).toBe("playing");
    expect(s.positionSec).toBe(4);
    expect(s.furthestSec).toBe(4);
  });

  it("row 10 fallback: an ordinary TICK flush (not the dedicated gate hit) reaching QUIZ_PENDING while still 'playing' opens the quiz", () => {
    const s = watchReducer(playing, { type: "EVENTS_SYNCED", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13, currentQuestionId: "q1" });
    expect(s.status).toBe("quiz_open");
    expect(s.quizPhase).toBe("ready");
    expect(s.currentQuestionId).toBe("q1");
  });

  it("QUIZ_PENDING while not 'playing' (e.g. already mid gate-sync) does not re-derive a status change", () => {
    const syncing = watchReducer(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const s = watchReducer(syncing, { type: "EVENTS_SYNCED", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13, currentQuestionId: "q1" });
    expect(s.status).toBe("quiz_open");
    expect(s.quizPhase).toBe("syncing"); // untouched — GATE_TICK_RESULT owns that transition, not EVENTS_SYNCED
  });
});

describe("row 13, 11: answering", () => {
  function atQuiz() {
    return run([
      { type: "SESSION_LOADED", session: session() },
      { type: "PLAY_CLICKED" },
      { type: "QUIZ_GATE_HIT", questionId: "q1" },
      { type: "GATE_TICK_RESULT", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 },
    ]);
  }

  it("ANSWER_SUBMITTED only applies when ready to answer", () => {
    const s = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    expect(s.quizPhase).toBe("submitting");
    expect(s.pendingChoice).toBe("D");
  });

  it("correct answer: passedQuestionIds grows, feedback correct, quizPhase back to ready (transient)", () => {
    const submitting = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const s = watchReducer(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    expect(s.passedQuestionIds).toEqual(["q1"]);
    expect(s.currentQuestionId).toBeNull();
    expect(s.feedback).toMatchObject({ tone: "correct" });
    expect(s.status).toBe("quiz_open"); // still open until the 900ms timer fires
  });

  it("QUIZ_RESUME_AFTER_CORRECT closes the modal → paused (row 13)", () => {
    const submitting = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const correct = watchReducer(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    const s = watchReducer(correct, { type: "QUIZ_RESUME_AFTER_CORRECT", hidden: false });
    expect(s.status).toBe("paused");
    expect(s.quizPhase).toBeNull();
    expect(s.pausedByTabHidden).toBe(false);
  });

  it("QUIZ_RESUME_AFTER_CORRECT with hidden:true tags pausedByTabHidden so the notice can show", () => {
    const submitting = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const correct = watchReducer(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    const s = watchReducer(correct, { type: "QUIZ_RESUME_AFTER_CORRECT", hidden: true });
    expect(s.status).toBe("paused");
    expect(s.pausedByTabHidden).toBe(true);
  });

  it("wrong answer (row 11): that choice disabled, others re-enabled, stays quiz_open", () => {
    const submitting = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "A" });
    const s = watchReducer(submitting, { type: "ANSWER_ACCEPTED", result: { correct: false, state: "QUIZ_PENDING" } });
    expect(s.status).toBe("quiz_open");
    expect(s.quizPhase).toBe("ready");
    expect(s.wrongChoiceLabels).toEqual(["A"]);
    expect(s.feedback).toMatchObject({ tone: "wrong" });
  });

  it("a second wrong choice accumulates in wrongChoiceLabels", () => {
    let s = atQuiz();
    s = watchReducer(s, { type: "ANSWER_SUBMITTED", choice: "A" });
    s = watchReducer(s, { type: "ANSWER_ACCEPTED", result: { correct: false, state: "QUIZ_PENDING" } });
    s = watchReducer(s, { type: "ANSWER_SUBMITTED", choice: "B" });
    s = watchReducer(s, { type: "ANSWER_ACCEPTED", result: { correct: false, state: "QUIZ_PENDING" } });
    expect(s.wrongChoiceLabels).toEqual(["A", "B"]);
  });

  it("answer network failure: re-enabled, not marked wrong", () => {
    const submitting = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "A" });
    const s = watchReducer(submitting, { type: "ANSWER_FAILED", code: "network" });
    expect(s.quizPhase).toBe("ready");
    expect(s.wrongChoiceLabels).toEqual([]);
    expect(s.feedback).toMatchObject({ tone: "error" });
  });

  it("ANSWER_FAILED NOT_AT_QUIZ behaves like the gate fallback (row 12)", () => {
    const submitting = watchReducer(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "A" });
    const s = watchReducer(submitting, { type: "ANSWER_FAILED", code: "NOT_AT_QUIZ" });
    expect(s.status).toBe("paused");
    expect(s.quizPhase).toBeNull();
    expect(s.toastRequest?.message).toBeTruthy();
  });
});

describe("row 14: resync — 409 SEQ_CONFLICT and rejected progress", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("SEQ_CONFLICT adopts server state/position and always toasts", () => {
    const s = watchReducer(playing, { type: "SEQ_CONFLICT", state: "PAUSED", positionSec: 9, furthestSec: 12 });
    expect(s.status).toBe("paused");
    expect(s.positionSec).toBe(9);
    expect(s.furthestSec).toBe(12);
    expect(s.pendingSeekTo).toBe(9);
    expect(s.toastRequest?.message).toBeTruthy();
  });

  it("SEQ_CONFLICT adopting PLAYING keeps/returns to playing", () => {
    const paused = watchReducer(playing, { type: "PAUSE_CLICKED" });
    const s = watchReducer(paused, { type: "SEQ_CONFLICT", state: "PLAYING", positionSec: 5, furthestSec: 5 });
    expect(s.status).toBe("playing");
  });

  it("rejected progress with a small jump (< 2s) resyncs silently, no toast", () => {
    const s = watchReducer(playing, { type: "PROGRESS_REJECTED", positionSec: 10, furthestSec: 10, jumpSec: 1.5 });
    expect(s.positionSec).toBe(10);
    expect(s.pendingSeekTo).toBe(10);
    expect(s.toastRequest).toBeNull();
  });

  it("rejected progress with a jump >= 2s toasts", () => {
    const s = watchReducer(playing, { type: "PROGRESS_REJECTED", positionSec: 10, furthestSec: 10, jumpSec: 5 });
    expect(s.toastRequest?.message).toBeTruthy();
  });

  it("row 15: client seek guard snaps back and toasts", () => {
    const s = watchReducer(playing, { type: "CLIENT_SEEK_GUARD", furthestSec: 8 });
    expect(s.pendingSeekTo).toBe(8);
    expect(s.toastRequest?.message).toBeTruthy();
  });

  it("SEEK_CONSUMED clears the pending seek", () => {
    const jumped = watchReducer(playing, { type: "CLIENT_SEEK_GUARD", furthestSec: 8 });
    const s = watchReducer(jumped, { type: "SEEK_CONSUMED" });
    expect(s.pendingSeekTo).toBeNull();
  });
});

describe("rows 16-19: ended, claiming, rewarded", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("row 16: VIDEO_ENDED → ended", () => {
    const s = watchReducer(playing, { type: "VIDEO_ENDED" });
    expect(s.status).toBe("ended");
  });

  it("row 18: ENDED_ACCEPTED → claiming", () => {
    const ended = watchReducer(playing, { type: "VIDEO_ENDED" });
    const s = watchReducer(ended, { type: "ENDED_ACCEPTED" });
    expect(s.status).toBe("claiming");
  });

  it("row 17: ENDED_NOT_WATCHED → back to playing, keeps playing, inline notice", () => {
    const ended = watchReducer(playing, { type: "VIDEO_ENDED" });
    const s = watchReducer(ended, { type: "ENDED_NOT_WATCHED", seekTo: 30 });
    expect(s.status).toBe("playing");
    expect(s.pendingSeekTo).toBe(30);
    expect(s.inlineNotice).toBe("ended_fallback");
  });

  it("row 19: CLAIM_ACCEPTED awarded → rewarded, RewardCard data set, no replay notice", () => {
    const claiming = watchReducer(watchReducer(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchReducer(claiming, { type: "CLAIM_ACCEPTED", result: { awarded: true, points: 50, totalPoints: 50 } });
    expect(s.status).toBe("rewarded");
    expect(s.claimResult).toEqual({ awarded: true, points: 50, totalPoints: 50 });
    expect(s.inlineNotice).toBeNull();
    expect(s.totalPoints).toBe(50);
  });

  it("row 21: CLAIM_ACCEPTED not awarded (replay end) → rewarded status, replay_end notice", () => {
    const claiming = watchReducer(watchReducer(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchReducer(claiming, { type: "CLAIM_ACCEPTED", result: { awarded: false, points: 0, totalPoints: 50 } });
    expect(s.status).toBe("rewarded");
    expect(s.inlineNotice).toBe("replay_end");
  });

  it("CLAIM_FAILED sets claimError without leaving claiming", () => {
    const claiming = watchReducer(watchReducer(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchReducer(claiming, { type: "CLAIM_FAILED" });
    expect(s.status).toBe("claiming");
    expect(s.claimError).toBe(true);
  });

  it("CLAIM_NOT_ENDED (422 race) behaves like the ENDED fallback", () => {
    const claiming = watchReducer(watchReducer(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchReducer(claiming, { type: "CLAIM_NOT_ENDED" });
    expect(s.status).toBe("playing");
    expect(s.inlineNotice).toBe("ended_fallback");
  });
});

describe("replay and retry", () => {
  it("REPLAY_REQUESTED goes to loading in place (keeps the player frame)", () => {
    const rewarded = watchReducer(initialWatchState, { type: "CLAIM_ACCEPTED", result: { awarded: true, points: 50, totalPoints: 50 } });
    const s = watchReducer(rewarded, { type: "REPLAY_REQUESTED" });
    expect(s.status).toBe("loading");
    expect(s.reloadingInPlace).toBe(true);
  });

  it("RETRY_REQUESTED from error clears the error and reloads", () => {
    const errored = watchReducer(initialWatchState, { type: "SESSION_LOAD_FAILED", reason: "network" });
    const s = watchReducer(errored, { type: "RETRY_REQUESTED" });
    expect(s.status).toBe("loading");
    expect(s.error).toBeNull();
  });

  it("RETRY_REQUESTED while claimError clears it without touching status", () => {
    const withError = { ...initialWatchState, status: "claiming" as const, claimError: true };
    const s = watchReducer(withError, { type: "RETRY_REQUESTED" });
    expect(s.status).toBe("claiming");
    expect(s.claimError).toBe(false);
  });
});

describe("errors, points, offline", () => {
  it("SESSION_LOAD_FAILED not_found vs network use different copy", () => {
    const a = watchReducer(initialWatchState, { type: "SESSION_LOAD_FAILED", reason: "not_found" });
    const b = watchReducer(initialWatchState, { type: "SESSION_LOAD_FAILED", reason: "network" });
    expect(a.error).toBe(WATCH_ERRORS.videoNotFound);
    expect(b.error).toBe(WATCH_ERRORS.sessionLoadFailed);
    expect(a.status).toBe("error");
  });

  it("PLAYER_ERROR sets the player-failed error", () => {
    const s = watchReducer(initialWatchState, { type: "PLAYER_ERROR" });
    expect(s.error).toBe(WATCH_ERRORS.playerFailed);
  });

  it("LOADING_SLOW only applies while still loading", () => {
    const s = watchReducer(initialWatchState, { type: "LOADING_SLOW" });
    expect(s.loadingSlow).toBe(true);
    const ready = watchReducer(initialWatchState, { type: "SESSION_LOADED", session: session() });
    const s2 = watchReducer(ready, { type: "LOADING_SLOW" });
    expect(s2.loadingSlow).toBe(false);
  });

  it("ME_LOADED / ME_FAILED toggle points state", () => {
    const s = watchReducer(initialWatchState, { type: "ME_LOADED", me: { totalPoints: 100, rewardedVideoIds: ["v1"] } });
    expect(s.totalPoints).toBe(100);
    expect(s.pointsUnavailable).toBe(false);
    const f = watchReducer(s, { type: "ME_FAILED" });
    expect(f.pointsUnavailable).toBe(true);
  });

  it("OFFLINE requests a sticky toast", () => {
    const off = watchReducer(initialWatchState, { type: "OFFLINE" });
    expect(off.toastRequest?.message).toBeTruthy();
  });
});
