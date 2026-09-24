import { describe, expect, it } from "vitest";
import { applyAnswer, applyClientEvents } from "@/backend/domain/session-state-machine";
import type { ClientEvent, SessionSnapshot, VideoRules } from "@/backend/domain/types";
import type { ClientEventType, SessionState } from "@/shared/constants/session";
import { at, ev, playing, session, T0, VIDEO } from "./fixtures";

/** Applies one event at `atSec` and returns the new session and its audit row. */
function one(s: SessionSnapshot, e: ClientEvent, atSec = 0, video: VideoRules = VIDEO) {
  const r = applyClientEvents(s, video, [e], at(atSec));
  return { s: r.session, rec: r.events[0] };
}

const Q1 = { id: "q1", correctChoice: "D", labels: ["A", "B", "C", "D"] };

describe("§5 transition table", () => {
  it.each<SessionState>(["CREATED", "PAUSED"])("%s + PLAY → PLAYING, lastPlayingAt = serverAt, no credit", (state) => {
    const { s, rec } = one(session({ state, playedWallSec: 5 }), ev("PLAY", 7), 30);
    expect(rec).toMatchObject({ accepted: true, fromState: state, toState: "PLAYING", positionSec: 7 });
    expect(s).toMatchObject({ state: "PLAYING", lastPlayingAt: at(30), playedWallSec: 5, positionSec: 0 });
  });

  it("PLAYING + PLAY → PLAYING no-op (accepted, not flagged)", () => {
    const { s, rec } = one(playing(), ev("PLAY"), 2);
    expect(rec).toMatchObject({ accepted: true, rejectReason: null, toState: "PLAYING" });
    expect(s).toMatchObject({ state: "PLAYING", flagged: false, softRejectCount: 0 });
  });

  it.each<ClientEventType>(["PAUSE", "TAB_HIDDEN"])("PLAYING + %s → PAUSED, credits play time, lastPlayingAt = null", (type) => {
    const { s, rec } = one(playing({ bankSec: 0 }), ev(type, 4), 4);
    expect(rec).toMatchObject({ accepted: true, fromState: "PLAYING", toState: "PAUSED" });
    expect(s.state).toBe("PAUSED");
    expect(s.lastPlayingAt).toBeNull();
    expect(s.playedWallSec).toBeCloseTo(4);
    expect(s.bankSec).toBeCloseTo(4.4);
    expect(s.positionSec).toBe(0); // PAUSE only records its position
  });

  it.each<[SessionState, ClientEventType]>([
    ["PAUSED", "PAUSE"],
    ["PAUSED", "TAB_HIDDEN"],
    ["CREATED", "PAUSE"],
    ["CREATED", "TAB_HIDDEN"],
  ])("%s + %s → same (no-op)", (state, type) => {
    const before = session({ state, positionSec: 3 });
    const { s, rec } = one(before, ev(type, 9));
    expect(rec).toMatchObject({ accepted: true, toState: state });
    expect(s).toEqual(before);
  });

  it("PLAYING + TICK → PLAYING, advances position and furthest, pays from the bank", () => {
    const { s, rec } = one(playing({ positionSec: 5, furthestSec: 5, bankSec: 0 }), ev("TICK", 6), 1);
    expect(rec).toMatchObject({ accepted: true, toState: "PLAYING" });
    expect(s).toMatchObject({ positionSec: 6, furthestSec: 6, playedWallSec: 1 });
    expect(s.bankSec).toBeCloseTo(0.1); // +1.1 credit − 1 need
  });

  it("PLAYING + TICK at/after the next unpassed triggerSec → QUIZ_PENDING, clamped, credited, lastPlayingAt = null", () => {
    const { s, rec } = one(playing({ positionSec: 12, furthestSec: 12, bankSec: 0.5, playedWallSec: 11 }), ev("TICK", 13.4), 1);
    expect(rec).toMatchObject({ accepted: true, fromState: "PLAYING", toState: "QUIZ_PENDING", positionSec: 13.4 });
    expect(s).toMatchObject({
      state: "QUIZ_PENDING",
      currentQuestionId: "q1",
      positionSec: 13,
      furthestSec: 13,
      playedWallSec: 12,
      lastPlayingAt: null,
    });
  });

  it("PLAYING + TICK exactly at triggerSec enters the quiz", () => {
    const { s } = one(playing({ positionSec: 12, furthestSec: 12 }), ev("TICK", 13), 1);
    expect(s).toMatchObject({ state: "QUIZ_PENDING", positionSec: 13 });
  });

  it.each<SessionState>(["PAUSED", "CREATED"])("%s + TICK → same, recorded only, no position change", (state) => {
    const before = session({ state, positionSec: 3, furthestSec: 3 });
    const { s, rec } = one(before, ev("TICK", 4));
    expect(rec).toMatchObject({ accepted: true, toState: state, positionSec: 4 });
    expect(s).toEqual(before);
  });

  it.each<ClientEventType>(["PLAY", "PAUSE", "TAB_HIDDEN"])("QUIZ_PENDING + %s → QUIZ_PENDING no-op", (type) => {
    const before = session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 });
    const { s, rec } = one(before, ev(type, 13));
    expect(rec).toMatchObject({ accepted: true, toState: "QUIZ_PENDING" });
    expect(s).toEqual(before);
  });

  it("QUIZ_PENDING + TICK → rejected QUIZ_REQUIRED (not flagged, not a soft reject)", () => {
    const before = session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 });
    const { s, rec } = one(before, ev("TICK", 14));
    expect(rec).toMatchObject({ accepted: false, rejectReason: "QUIZ_REQUIRED", toState: "QUIZ_PENDING" });
    expect(s).toEqual(before);
  });

  it("QUIZ_PENDING + ANSWER correct → PAUSED, question appended to passedQuestionIds", () => {
    const before = session({ state: "QUIZ_PENDING", currentQuestionId: "q1", positionSec: 13, furthestSec: 13 });
    const r = applyAnswer(before, Q1, "D");
    expect(r).toMatchObject({ ok: true, correct: true });
    if (!r.ok) throw new Error("unreachable");
    expect(r.session).toMatchObject({ state: "PAUSED", currentQuestionId: null, passedQuestionIds: ["q1"], positionSec: 13 });
    expect(r.event).toMatchObject({
      seq: null,
      type: "ANSWER",
      accepted: true,
      fromState: "QUIZ_PENDING",
      toState: "PAUSED",
      payload: { questionId: "q1", choice: "D", correct: true },
    });
  });

  it("QUIZ_PENDING + ANSWER wrong → QUIZ_PENDING, attempt recorded", () => {
    const before = session({ state: "QUIZ_PENDING", currentQuestionId: "q1" });
    const r = applyAnswer(before, Q1, "C");
    expect(r).toMatchObject({ ok: true, correct: false, session: before });
    if (!r.ok) throw new Error("unreachable");
    expect(r.event).toMatchObject({ type: "ANSWER", fromState: "QUIZ_PENDING", toState: "QUIZ_PENDING", payload: { correct: false } });
  });

  it("ANSWER outside QUIZ_PENDING or for another question → NOT_AT_QUIZ; unknown label → INVALID_CHOICE", () => {
    expect(applyAnswer(session({ state: "PAUSED" }), Q1, "D")).toEqual({ ok: false, code: "NOT_AT_QUIZ" });
    expect(applyAnswer(session({ state: "QUIZ_PENDING", currentQuestionId: "q2" }), Q1, "D")).toEqual({
      ok: false,
      code: "NOT_AT_QUIZ",
    });
    expect(applyAnswer(session({ state: "QUIZ_PENDING", currentQuestionId: "q1" }), Q1, "E")).toEqual({
      ok: false,
      code: "INVALID_CHOICE",
    });
  });

  it.each<SessionState>(["PLAYING", "PAUSED"])("%s + SEEK back (pos < positionSec) → same, positionSec = pos, furthest unchanged", (state) => {
    const { s, rec } = one(session({ state, lastPlayingAt: state === "PLAYING" ? T0 : null, positionSec: 20, furthestSec: 25 }), ev("SEEK", 8));
    expect(rec).toMatchObject({ accepted: true, toState: state });
    expect(s).toMatchObject({ state, positionSec: 8, furthestSec: 25 });
  });

  it.each<SessionState>(["PLAYING", "PAUSED"])("%s + SEEK forward: ≤ furthest accept · ≤ furthest+1.5 clamp · above → SEEK_FORWARD (flagged)", (state) => {
    const base = session({ state, lastPlayingAt: state === "PLAYING" ? T0 : null, positionSec: 10, furthestSec: 20 });
    expect(one(base, ev("SEEK", 20)).s).toMatchObject({ positionSec: 20, furthestSec: 20 });
    expect(one(base, ev("SEEK", 21.5)).s).toMatchObject({ positionSec: 20, furthestSec: 20 });
    const { s, rec } = one(base, ev("SEEK", 21.6));
    expect(rec).toMatchObject({ accepted: false, rejectReason: "SEEK_FORWARD", toState: state });
    expect(s).toMatchObject({ positionSec: 10, furthestSec: 20, flagged: true });
  });

  it.each<SessionState>(["PLAYING", "PAUSED"])("%s + ENDED when canEnd → ENDED, endedAt = serverAt", (state) => {
    const watched = { passedQuestionIds: ["q1"], positionSec: 43.5, furthestSec: 43.5, playedWallSec: 40 };
    const { s, rec } = one(session({ state, lastPlayingAt: state === "PLAYING" ? T0 : null, ...watched }), ev("ENDED", 44), 0);
    expect(rec).toMatchObject({ accepted: true, fromState: state, toState: "ENDED" });
    expect(s).toMatchObject({ state: "ENDED", endedAt: at(0), lastPlayingAt: null });
  });

  it.each<SessionState>(["PLAYING", "PAUSED"])("%s + ENDED when not canEnd → rejected NOT_WATCHED, softRejectCount += 1", (state) => {
    const { s, rec } = one(session({ state, lastPlayingAt: state === "PLAYING" ? T0 : null, passedQuestionIds: ["q1"], furthestSec: 30, playedWallSec: 30 }), ev("ENDED", 44));
    expect(rec).toMatchObject({ accepted: false, rejectReason: "NOT_WATCHED", toState: state });
    expect(s).toMatchObject({ state, softRejectCount: 1, flagged: false, endedAt: null });
  });

  it.each<[SessionState, ClientEventType]>([
    ["ENDED", "PLAY"],
    ["ENDED", "PAUSE"],
    ["ENDED", "TAB_HIDDEN"],
    ["ENDED", "TICK"],
    ["ENDED", "SEEK"],
    ["ENDED", "ENDED"],
    ["CREATED", "SEEK"],
    ["CREATED", "ENDED"],
    ["QUIZ_PENDING", "SEEK"],
    ["QUIZ_PENDING", "ENDED"],
  ])("%s + %s → same, rejected INVALID_TRANSITION (not flagged)", (state, type) => {
    const before = session({ state, currentQuestionId: state === "QUIZ_PENDING" ? "q1" : null, positionSec: 5, furthestSec: 5 });
    const { s, rec } = one(before, ev(type, 6));
    expect(rec).toMatchObject({ accepted: false, rejectReason: "INVALID_TRANSITION", fromState: state, toState: state });
    expect(s).toEqual(before);
  });
});

describe("§5 position rules", () => {
  it("only TICK raises furthestSec; PLAY / PAUSE / ENDED only record their position", () => {
    const r = applyClientEvents(session({ state: "PAUSED", positionSec: 5, furthestSec: 5 }), VIDEO, [ev("PLAY", 9), ev("PAUSE", 9)], at(1));
    expect(r.session).toMatchObject({ positionSec: 5, furthestSec: 5 });
    expect(r.events.map((e) => e.positionSec)).toEqual([9, 9]);
  });

  it("SEEK never raises furthestSec", () => {
    const { s } = one(playing({ positionSec: 5, furthestSec: 5 }), ev("SEEK", 6));
    expect(s).toMatchObject({ positionSec: 5, furthestSec: 5 });
  });
});

describe("§5 batch rule", () => {
  it("after the first rejected TICK/SEEK the rest of the batch's TICK/SEEKs are BATCH_ABORTED; others still run", () => {
    const start = playing({ positionSec: 5, furthestSec: 5, bankSec: 0 });
    const r = applyClientEvents(start, VIDEO, [ev("TICK", 6), ev("TICK", 9), ev("TICK", 7), ev("PAUSE", 7), ev("SEEK", 2)], at(1));
    expect(r.events.map((e) => [e.type, e.accepted, e.rejectReason])).toEqual([
      ["TICK", true, null],
      ["TICK", false, "SPEED_EXCEEDED"],
      ["TICK", false, "BATCH_ABORTED"],
      ["PAUSE", true, null],
      ["SEEK", false, "BATCH_ABORTED"],
    ]);
    expect(r.session).toMatchObject({ state: "PAUSED", positionSec: 6, furthestSec: 6 });
  });

  it("BATCH_ABORTED is neither flagged nor a soft reject", () => {
    const start = playing({ positionSec: 5, furthestSec: 5, bankSec: 0.5 });
    const r = applyClientEvents(start, VIDEO, [ev("TICK", 6.4), ev("TICK", 5.5), ev("TICK", 5.6)], at(0));
    expect(r.events.map((e) => e.rejectReason)).toEqual(["SPEED_EXCEEDED", "BATCH_ABORTED", "BATCH_ABORTED"]);
    expect(r.session).toMatchObject({ softRejectCount: 1, flagged: false, positionSec: 5 });
  });

  it("a rejected non-progress event does not abort later progress events", () => {
    const r = applyClientEvents(playing({ positionSec: 5, furthestSec: 5 }), VIDEO, [ev("ENDED", 5), ev("TICK", 6)], at(1));
    expect(r.events.map((e) => e.rejectReason)).toEqual(["NOT_WATCHED", null]);
    expect(r.session.furthestSec).toBe(6);
  });

  it("does not mutate the input session", () => {
    const start = playing({ positionSec: 5, furthestSec: 5 });
    const copy = structuredClone(start);
    applyClientEvents(start, VIDEO, [ev("TICK", 6), ev("PAUSE", 6)], at(1));
    expect(start).toEqual(copy);
  });
});

describe("§6 position validation: finite and within [0, durationSec + 5]", () => {
  it("rejects non-finite or out-of-range positions as INVALID_POSITION (not flagged, not a soft reject)", () => {
    const before = playing({ positionSec: 5, furthestSec: 5 });
    for (const pos of [NaN, Infinity, -Infinity, -1, VIDEO.durationSec + 5.01]) {
      const { s, rec } = one(before, ev("TICK", pos));
      expect(rec).toMatchObject({ accepted: false, rejectReason: "INVALID_POSITION" });
      expect(s).toMatchObject({ softRejectCount: 0, flagged: false, positionSec: 5, furthestSec: 5 });
    }
  });

  it("applies to every event type, not only TICK/SEEK", () => {
    const { rec } = one(session({ state: "PAUSED" }), ev("PLAY", NaN));
    expect(rec).toMatchObject({ accepted: false, rejectReason: "INVALID_POSITION" });
  });

  it("accepts the boundary position durationSec + 5 (rejected only by the bank rule, not INVALID_POSITION)", () => {
    const { rec } = one(playing({ furthestSec: 0 }), ev("TICK", VIDEO.durationSec + 5), 1);
    expect(rec.rejectReason).not.toBe("INVALID_POSITION");
  });
});
