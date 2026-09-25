// Ported 1:1 from watch.reducer.test.ts onto the discriminated-union shape in watch.machine.ts.
// Same scenarios/inputs as the old suite; asserts through the new Phase-based shape instead of the
// old flat status/quizPhase/pausedByTabHidden fields.
import { describe, expect, it } from "vitest";
import { initialWatchState, watchMachine, WATCH_ERRORS, type WatchState } from "@/frontend/public/state/watch.machine";
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
  return actions.reduce(watchMachine, start);
}

describe("SESSION_LOADED — derives the starting phase from server state (spec §4.4 rows 2-5)", () => {
  it("row 2: CREATED, positionSec 0 → ready, no resumed banner", () => {
    const s = run([{ type: "SESSION_LOADED", session: session() }]);
    expect(s.phase).toMatchObject({ kind: "ready", resumedAtSec: null });
  });

  it("row 3: PAUSED with positionSec > 0 → ready, resumed banner shown", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "PAUSED", positionSec: 20, furthestSec: 20 }) }]);
    expect(s.phase).toMatchObject({ kind: "ready", resumedAtSec: 20 });
  });

  it("PAUSED with positionSec 6.9 → seekRequest.toSec 6.9, so the player actually seeks to where the banner claims", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "PAUSED", positionSec: 6.9, furthestSec: 6.9 }) }]);
    expect(s.seekRequest).toEqual({ toSec: 6.9, resume: false });
  });

  it("a brand new session (positionSec 0) still seeks to 0, not null (replay restarts from 0)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session() }]);
    expect(s.seekRequest).toEqual({ toSec: 0, resume: false });
  });

  it("a resumed QUIZ_PENDING session also seeks to its (nonzero) position, not just PAUSED", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 }) }]);
    expect(s.seekRequest).toEqual({ toSec: 13, resume: false });
  });

  it("row 4: QUIZ_PENDING → quiz phase, answering step (no syncing step)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 }) }]);
    expect(s.phase).toMatchObject({ kind: "quiz", questionId: "q1", step: "answering" });
  });

  it("row 5: ENDED, not rewarded → claiming (auto-claim)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "ENDED", furthestSec: 44 }) }]);
    expect(s.phase).toMatchObject({ kind: "claiming", failed: false });
  });

  it("isReplay or alreadyRewarded shows the replay banner (row 20)", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ isReplay: true }) }]);
    expect(s.showReplayBanner).toBe(true);
  });

  it("no stuck state: QUIZ_PENDING with a null currentQuestionId (server desync) lands on ready, not a stuck quiz phase with no modal", () => {
    const s = run([{ type: "SESSION_LOADED", session: session({ state: "QUIZ_PENDING", currentQuestionId: null, positionSec: 13, furthestSec: 13 }) }]);
    expect(s.phase).toMatchObject({ kind: "ready" });
  });
});

describe("play / pause / tab-hidden", () => {
  const ready = run([{ type: "SESSION_LOADED", session: session() }]);

  it("PLAY_CLICKED from ready → playing, clears the replay banner", () => {
    const s = watchMachine({ ...ready, showReplayBanner: true }, { type: "PLAY_CLICKED" });
    expect(s.phase).toMatchObject({ kind: "playing" });
    expect(s.showReplayBanner).toBe(false);
  });

  it("PAUSE_CLICKED from playing → paused, reason user", () => {
    const playing = watchMachine(ready, { type: "PLAY_CLICKED" });
    const s = watchMachine(playing, { type: "PAUSE_CLICKED" });
    expect(s.phase).toEqual({ kind: "paused", reason: "user" });
  });

  it("TAB_HIDDEN from playing → paused, reason tab_hidden (row 8)", () => {
    const playing = watchMachine(ready, { type: "PLAY_CLICKED" });
    const s = watchMachine(playing, { type: "TAB_HIDDEN" });
    expect(s.phase).toEqual({ kind: "paused", reason: "tab_hidden" });
  });

  it("PLAY_CLICKED is a no-op outside ready/paused", () => {
    const s = watchMachine(initialWatchState, { type: "PLAY_CLICKED" }); // phase: loading
    expect(s.phase.kind).toBe("loading");
  });
});

describe("quiz gate (rows 9-12)", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("row 9: QUIZ_GATE_HIT → quiz phase, syncing", () => {
    const s = watchMachine(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "syncing", questionId: "q1" });
  });

  it("row 10: gate TICK confirms QUIZ_PENDING → syncing becomes answering", () => {
    const syncing = watchMachine(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const s = watchMachine(syncing, { type: "GATE_TICK_RESULT", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "answering" });
  });

  it("row 12: gate TICK result isn't QUIZ_PENDING → gate fallback, resync + toast", () => {
    const syncing = watchMachine(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const s = watchMachine(syncing, { type: "GATE_TICK_RESULT", state: "PLAYING", positionSec: 11, furthestSec: 12 });
    expect(s.phase).toMatchObject({ kind: "playing" });
    expect(s.seekRequest).toEqual({ toSec: 11, resume: true });
    expect(s.toast?.message).toBeTruthy();
  });

  it("a stale GATE_TICK_RESULT (already left syncing) is ignored", () => {
    const syncing = watchMachine(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const answering = watchMachine(syncing, { type: "GATE_TICK_RESULT", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    const s = watchMachine(answering, { type: "GATE_TICK_RESULT", state: "PLAYING", positionSec: 99, furthestSec: 99 });
    expect(s).toEqual(answering); // no change — step is no longer "syncing"
  });
});

describe("EVENTS_SYNCED — every accepted events response is dispatched", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("row 6: an ordinary accepted sync just advances session position/furthest, phase untouched", () => {
    const s = watchMachine(playing, { type: "EVENTS_SYNCED", state: "PLAYING", positionSec: 4, furthestSec: 4, currentQuestionId: null });
    expect(s.phase).toMatchObject({ kind: "playing" });
    expect(s.session?.positionSec).toBe(4);
    expect(s.session?.furthestSec).toBe(4);
  });

  it("row 10 fallback: an ordinary TICK flush (not the dedicated gate hit) reaching QUIZ_PENDING while still 'playing' opens the quiz", () => {
    const s = watchMachine(playing, { type: "EVENTS_SYNCED", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13, currentQuestionId: "q1" });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "answering", questionId: "q1" });
  });

  it("QUIZ_PENDING while not 'playing' (e.g. already mid gate-sync) does not re-derive a phase change", () => {
    const syncing = watchMachine(playing, { type: "QUIZ_GATE_HIT", questionId: "q1" });
    const s = watchMachine(syncing, { type: "EVENTS_SYNCED", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13, currentQuestionId: "q1" });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "syncing" }); // untouched — GATE_TICK_RESULT owns that transition, not EVENTS_SYNCED
  });

  it("no stuck state: QUIZ_PENDING with a null currentQuestionId stays 'playing' instead of risking a stuck quiz phase with no modal", () => {
    const s = watchMachine(playing, { type: "EVENTS_SYNCED", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13, currentQuestionId: null });
    expect(s.phase).toMatchObject({ kind: "playing" });
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
    const s = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "submitting", pendingChoice: "D" });
  });

  it("correct answer: passedQuestionIds grows, feedback correct, step becomes 'correct' (transient)", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const s = watchMachine(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    expect(s.session?.passedQuestionIds).toEqual(["q1"]);
    expect(s.phase).toMatchObject({ kind: "quiz", step: "correct", feedback: { tone: "correct" } });
  });

  it("correct answer keeps the modal's own question live for the whole 900ms window (spec §4.4 row 13) — the old reducer instead nulled currentQuestionId here, closing the modal outright", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const s = watchMachine(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    expect(s.phase).toMatchObject({ kind: "quiz", questionId: "q1" });
  });

  it("a second ANSWER_SUBMITTED during step 'correct' is a no-op — the modal must not be answerable again before QUIZ_RESUME_AFTER_CORRECT closes it", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const correct = watchMachine(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    const s = watchMachine(correct, { type: "ANSWER_SUBMITTED", choice: "D" });
    expect(s).toEqual(correct);
  });

  it("QUIZ_RESUME_AFTER_CORRECT closes the modal → paused (row 13)", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const correct = watchMachine(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    const s = watchMachine(correct, { type: "QUIZ_RESUME_AFTER_CORRECT", hidden: false });
    expect(s.phase).toEqual({ kind: "paused", reason: "user" });
  });

  it("QUIZ_RESUME_AFTER_CORRECT with hidden:true tags reason tab_hidden so the notice can show", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "D" });
    const correct = watchMachine(submitting, { type: "ANSWER_ACCEPTED", result: { correct: true, state: "PAUSED" } });
    const s = watchMachine(correct, { type: "QUIZ_RESUME_AFTER_CORRECT", hidden: true });
    expect(s.phase).toEqual({ kind: "paused", reason: "tab_hidden" });
  });

  it("wrong answer (row 11): that choice disabled, others re-enabled, stays quiz/answering", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "A" });
    const s = watchMachine(submitting, { type: "ANSWER_ACCEPTED", result: { correct: false, state: "QUIZ_PENDING" } });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "answering", wrongChoices: ["A"], feedback: { tone: "wrong" } });
  });

  it("a second wrong choice accumulates in wrongChoices", () => {
    let s = atQuiz();
    s = watchMachine(s, { type: "ANSWER_SUBMITTED", choice: "A" });
    s = watchMachine(s, { type: "ANSWER_ACCEPTED", result: { correct: false, state: "QUIZ_PENDING" } });
    s = watchMachine(s, { type: "ANSWER_SUBMITTED", choice: "B" });
    s = watchMachine(s, { type: "ANSWER_ACCEPTED", result: { correct: false, state: "QUIZ_PENDING" } });
    expect(s.phase).toMatchObject({ kind: "quiz", wrongChoices: ["A", "B"] });
  });

  it("answer network failure: re-enabled, not marked wrong", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "A" });
    const s = watchMachine(submitting, { type: "ANSWER_FAILED", code: "network" });
    expect(s.phase).toMatchObject({ kind: "quiz", step: "answering", wrongChoices: [], feedback: { tone: "error" } });
  });

  it("ANSWER_FAILED NOT_AT_QUIZ behaves like the gate fallback (row 12)", () => {
    const submitting = watchMachine(atQuiz(), { type: "ANSWER_SUBMITTED", choice: "A" });
    const s = watchMachine(submitting, { type: "ANSWER_FAILED", code: "NOT_AT_QUIZ" });
    expect(s.phase).toEqual({ kind: "paused", reason: "user" });
    expect(s.toast?.message).toBeTruthy();
  });
});

describe("row 14: resync — 409 SEQ_CONFLICT and rejected progress", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("SEQ_CONFLICT adopts server state/position and always toasts", () => {
    const s = watchMachine(playing, { type: "SEQ_CONFLICT", state: "PAUSED", positionSec: 9, furthestSec: 12 });
    expect(s.phase).toEqual({ kind: "paused", reason: "user" });
    expect(s.session?.positionSec).toBe(9);
    expect(s.session?.furthestSec).toBe(12);
    expect(s.seekRequest).toEqual({ toSec: 9, resume: false });
    expect(s.toast?.message).toBeTruthy();
  });

  it("SEQ_CONFLICT adopting PLAYING keeps/returns to playing", () => {
    const paused = watchMachine(playing, { type: "PAUSE_CLICKED" });
    const s = watchMachine(paused, { type: "SEQ_CONFLICT", state: "PLAYING", positionSec: 5, furthestSec: 5 });
    expect(s.phase).toMatchObject({ kind: "playing" });
  });

  it("no stuck state: SEQ_CONFLICT landing on QUIZ_PENDING carries no questionId (the action never has one) — resyncs to paused, not a stuck quiz phase with no modal", () => {
    const s = watchMachine(playing, { type: "SEQ_CONFLICT", state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    expect(s.phase).toMatchObject({ kind: "paused" });
  });

  it("a SEQ_CONFLICT resync preserves a paused-because-tab-hidden reason instead of resetting it to 'user'", () => {
    const hiddenPaused = watchMachine(playing, { type: "TAB_HIDDEN" });
    expect(hiddenPaused.phase).toEqual({ kind: "paused", reason: "tab_hidden" });
    const s = watchMachine(hiddenPaused, { type: "SEQ_CONFLICT", state: "PAUSED", positionSec: 9, furthestSec: 12 });
    expect(s.phase).toEqual({ kind: "paused", reason: "tab_hidden" });
  });

  it("rejected progress with a small jump (< 2s) resyncs silently, no toast", () => {
    const s = watchMachine(playing, { type: "PROGRESS_REJECTED", positionSec: 10, furthestSec: 10, jumpSec: 1.5 });
    expect(s.session?.positionSec).toBe(10);
    expect(s.seekRequest).toEqual({ toSec: 10, resume: true });
    expect(s.toast).toBeNull();
  });

  it("rejected progress with a jump >= 2s toasts", () => {
    const s = watchMachine(playing, { type: "PROGRESS_REJECTED", positionSec: 10, furthestSec: 10, jumpSec: 5 });
    expect(s.toast?.message).toBeTruthy();
  });

  it("row 15: client seek guard snaps back and toasts", () => {
    const s = watchMachine(playing, { type: "CLIENT_SEEK_GUARD", furthestSec: 8 });
    expect(s.seekRequest).toEqual({ toSec: 8, resume: true });
    expect(s.toast?.message).toBeTruthy();
  });

  it("SEEK_CONSUMED clears the pending seek", () => {
    const jumped = watchMachine(playing, { type: "CLIENT_SEEK_GUARD", furthestSec: 8 });
    const s = watchMachine(jumped, { type: "SEEK_CONSUMED" });
    expect(s.seekRequest).toBeNull();
  });
});

describe("rows 16-19: ended, claiming, rewarded", () => {
  const playing = run([{ type: "SESSION_LOADED", session: session() }, { type: "PLAY_CLICKED" }]);

  it("row 16: VIDEO_ENDED → ending", () => {
    const s = watchMachine(playing, { type: "VIDEO_ENDED" });
    expect(s.phase).toEqual({ kind: "ending" });
  });

  it("row 18: ENDED_ACCEPTED → claiming", () => {
    const ended = watchMachine(playing, { type: "VIDEO_ENDED" });
    const s = watchMachine(ended, { type: "ENDED_ACCEPTED" });
    expect(s.phase).toEqual({ kind: "claiming", failed: false });
  });

  it("the ended_fallback notice survives a pause/resume — PAUSE_CLICKED/PLAY_CLICKED must not clear it, matching main", () => {
    const ended = watchMachine(playing, { type: "VIDEO_ENDED" });
    const fallback = watchMachine(ended, { type: "ENDED_NOT_WATCHED", seekTo: 30 });
    expect(fallback.inlineNotice).toBe("ended_fallback");
    const paused = watchMachine(fallback, { type: "PAUSE_CLICKED" });
    expect(paused.inlineNotice, "must survive a pause").toBe("ended_fallback");
    const resumed = watchMachine(paused, { type: "PLAY_CLICKED" });
    expect(resumed.inlineNotice, "must survive the resume too").toBe("ended_fallback");
  });

  it("row 17: ENDED_NOT_WATCHED → back to playing (endedFallback), keeps playing, seeks", () => {
    const ended = watchMachine(playing, { type: "VIDEO_ENDED" });
    const s = watchMachine(ended, { type: "ENDED_NOT_WATCHED", seekTo: 30 });
    expect(s.phase).toEqual({ kind: "playing" });
    expect(s.inlineNotice).toBe("ended_fallback");
    expect(s.seekRequest).toEqual({ toSec: 30, resume: true });
  });

  it("row 19: CLAIM_ACCEPTED awarded → rewarded, RewardCard data set, no replay notice", () => {
    const claiming = watchMachine(watchMachine(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchMachine(claiming, { type: "CLAIM_ACCEPTED", result: { awarded: true, points: 50, totalPoints: 50 } });
    expect(s.phase).toEqual({ kind: "rewarded", result: { awarded: true, points: 50, totalPoints: 50 } });
    expect(s.inlineNotice).toBeNull();
    expect(s.points.total).toBe(50);
  });

  it("row 21: CLAIM_ACCEPTED not awarded (replay end) → rewarded phase, replay_end notice", () => {
    const claiming = watchMachine(watchMachine(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchMachine(claiming, { type: "CLAIM_ACCEPTED", result: { awarded: false, points: 0, totalPoints: 50 } });
    expect(s.phase).toMatchObject({ kind: "rewarded" });
    expect(s.inlineNotice).toBe("replay_end");
  });

  it("CLAIM_FAILED sets phase.failed without leaving claiming", () => {
    const claiming = watchMachine(watchMachine(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchMachine(claiming, { type: "CLAIM_FAILED" });
    expect(s.phase).toEqual({ kind: "claiming", failed: true });
  });

  it("CLAIM_NOT_ENDED (422 race) behaves like the ENDED fallback", () => {
    const claiming = watchMachine(watchMachine(playing, { type: "VIDEO_ENDED" }), { type: "ENDED_ACCEPTED" });
    const s = watchMachine(claiming, { type: "CLAIM_NOT_ENDED" });
    expect(s.phase).toEqual({ kind: "playing" });
    expect(s.inlineNotice).toBe("ended_fallback");
  });
});

describe("replay and retry", () => {
  it("REPLAY_REQUESTED goes to loading in place (keeps the player frame)", () => {
    const rewarded = watchMachine(initialWatchState, { type: "CLAIM_ACCEPTED", result: { awarded: true, points: 50, totalPoints: 50 } });
    const s = watchMachine(rewarded, { type: "REPLAY_REQUESTED" });
    expect(s.phase).toEqual({ kind: "loading", slow: false });
    expect(s.reloadingInPlace).toBe(true);
  });

  it("RETRY_REQUESTED from error clears the error and reloads", () => {
    const errored = watchMachine(initialWatchState, { type: "SESSION_LOAD_FAILED", reason: "network" });
    const s = watchMachine(errored, { type: "RETRY_REQUESTED" });
    expect(s.phase).toEqual({ kind: "loading", slow: false });
    expect(s.reloadingInPlace).toBe(false);
  });

  it("a retry after a failed in-app replay keeps reloadingInPlace true, so the skeleton stays suppressed", () => {
    const rewarded = watchMachine(initialWatchState, { type: "CLAIM_ACCEPTED", result: { awarded: true, points: 50, totalPoints: 50 } });
    const replaying = watchMachine(rewarded, { type: "REPLAY_REQUESTED" });
    const errored = watchMachine(replaying, { type: "SESSION_LOAD_FAILED", reason: "network" });
    expect(errored.reloadingInPlace, "sanity: SESSION_LOAD_FAILED must not clear it either").toBe(true);
    const s = watchMachine(errored, { type: "RETRY_REQUESTED" });
    expect(s.phase).toEqual({ kind: "loading", slow: false });
    expect(s.reloadingInPlace).toBe(true);
  });

  it("RETRY_REQUESTED while claiming failed clears it without touching phase.kind", () => {
    const withError: WatchState = { ...initialWatchState, phase: { kind: "claiming", failed: true } };
    const s = watchMachine(withError, { type: "RETRY_REQUESTED" });
    expect(s.phase).toEqual({ kind: "claiming", failed: false });
  });
});

describe("errors, points, offline", () => {
  it("SESSION_LOAD_FAILED not_found vs network use different copy", () => {
    const a = watchMachine(initialWatchState, { type: "SESSION_LOAD_FAILED", reason: "not_found" });
    const b = watchMachine(initialWatchState, { type: "SESSION_LOAD_FAILED", reason: "network" });
    expect(a.phase).toEqual({ kind: "error", error: WATCH_ERRORS.videoNotFound });
    expect(b.phase).toEqual({ kind: "error", error: WATCH_ERRORS.sessionLoadFailed });
  });

  it("PLAYER_ERROR sets the player-failed error", () => {
    const s = watchMachine(initialWatchState, { type: "PLAYER_ERROR" });
    expect(s.phase).toEqual({ kind: "error", error: WATCH_ERRORS.playerFailed });
  });

  it("LOADING_SLOW only applies while still loading", () => {
    const s = watchMachine(initialWatchState, { type: "LOADING_SLOW" });
    expect(s.phase).toMatchObject({ kind: "loading", slow: true });
    const ready = watchMachine(initialWatchState, { type: "SESSION_LOADED", session: session() });
    const s2 = watchMachine(ready, { type: "LOADING_SLOW" });
    expect(s2.phase.kind).toBe("ready");
  });

  it("ME_LOADED / ME_FAILED toggle points state", () => {
    const s = watchMachine(initialWatchState, { type: "ME_LOADED", me: { totalPoints: 100, rewardedVideoIds: ["v1"] } });
    expect(s.points).toEqual({ total: 100, unavailable: false });
    const f = watchMachine(s, { type: "ME_FAILED" });
    expect(f.points.unavailable).toBe(true);
  });

  it("OFFLINE requests a sticky toast", () => {
    const off = watchMachine(initialWatchState, { type: "OFFLINE" });
    expect(off.toast?.message).toBeTruthy();
  });
});
