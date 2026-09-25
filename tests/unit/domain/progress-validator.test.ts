import { describe, expect, it } from "vitest";
import { checkSeek, checkTick, creditPlayTime, quizGateAt } from "@/backend/domain/progress-validator";
import { applyClientEvents } from "@/backend/domain/session-state-machine";
import { applyResume } from "@/backend/domain/resume-policy";
import type { ClientEvent, SessionSnapshot } from "@/backend/domain/types";
import { at, ev, NO_QUIZ, playing, session, T0, VIDEO } from "./fixtures";

describe("§6.1 play-time credit", () => {
  it("credits Δ = serverAt − lastPlayingAt and refills the bank at 1.1×", () => {
    const s = creditPlayTime(playing({ playedWallSec: 2, bankSec: 1 }), at(3));
    expect(s.playedWallSec).toBeCloseTo(5);
    expect(s.bankSec).toBeCloseTo(4.3);
    expect(s.lastPlayingAt).toEqual(at(3));
  });

  it("caps Δ at 10 s (a lost PAUSE cannot bank idle time)", () => {
    const s = creditPlayTime(playing({ bankSec: 0 }), at(600));
    expect(s.playedWallSec).toBe(10);
    expect(s.bankSec).toBe(10);
  });

  it("caps the bank at 10 s", () => {
    expect(creditPlayTime(playing({ bankSec: 9 }), at(2)).bankSec).toBe(10);
  });

  it("credits nothing for a clock going backwards or a missing lastPlayingAt", () => {
    expect(creditPlayTime(playing({ lastPlayingAt: at(10) }), at(5)).playedWallSec).toBe(0);
    expect(creditPlayTime(playing({ lastPlayingAt: null }), at(5)).playedWallSec).toBe(0);
  });

  it("events of one batch share serverAt, so a batch adds no extra credit", () => {
    const r = applyClientEvents(playing({ bankSec: 0 }), NO_QUIZ, [ev("TICK", 1), ev("TICK", 2), ev("TICK", 3), ev("PLAY", 3)], at(5));
    expect(r.session.playedWallSec).toBeCloseTo(5);
  });

  it("is kept when the event itself is rejected (it measures PLAYING wall time)", () => {
    const r = applyClientEvents(playing({ bankSec: 0 }), NO_QUIZ, [ev("TICK", 30)], at(4));
    expect(r.events[0].rejectReason).toBe("SEEK_FORWARD");
    expect(r.session).toMatchObject({ playedWallSec: 4, lastPlayingAt: at(4), state: "PLAYING" });
  });

  it("never credits outside PLAYING", () => {
    const r = applyClientEvents(session({ state: "PAUSED", lastPlayingAt: T0 }), NO_QUIZ, [ev("PLAY")], at(9));
    expect(r.session.playedWallSec).toBe(0);
  });

  it("RESUME never credits", () => {
    const { session: s } = applyResume(playing({ playedWallSec: 3, bankSec: 1 }));
    expect(s).toMatchObject({ state: "PAUSED", playedWallSec: 3, bankSec: 1, lastPlayingAt: null });
  });
});

describe("§6.2 token bucket (checkTick)", () => {
  const s = session({ furthestSec: 10, bankSec: 1 });

  it("rewatching (pos ≤ furthestSec) is accepted and free", () => {
    expect(checkTick(s, 4)).toEqual({ ok: true, cost: 0 });
    expect(checkTick(s, 10)).toEqual({ ok: true, cost: 0 });
  });

  it("new ground costs pos − furthestSec", () => {
    const r = checkTick(s, 10.8);
    expect(r.ok && r.cost).toBeCloseTo(0.8);
  });

  it("a 1.6 s TICK gap is accepted when the bank covers it (no +1.5 s slack on TICK)", () => {
    const r = checkTick(session({ furthestSec: 10, bankSec: 3 }), 11.6);
    expect(r.ok && r.cost).toBeCloseTo(1.6);
  });

  it("need > bankSec → SPEED_EXCEEDED", () => {
    expect(checkTick(s, 11.2)).toEqual({ ok: false, reason: "SPEED_EXCEEDED" });
  });

  it("a 5 s jump with bank 4 → SPEED_EXCEEDED", () => {
    expect(checkTick(session({ furthestSec: 10, bankSec: 4 }), 15)).toEqual({ ok: false, reason: "SPEED_EXCEEDED" });
  });

  it("need > BANK_MAX_SEC (10) → SEEK_FORWARD, even with a full bank — larger than the bank can ever hold", () => {
    expect(checkTick(session({ furthestSec: 10, bankSec: 10 }), 20.1)).toEqual({ ok: false, reason: "SEEK_FORWARD" });
  });

  it("a single 10.1 s jump → SEEK_FORWARD", () => {
    expect(checkTick(session({ furthestSec: 0, bankSec: 3 }), 10.1)).toEqual({ ok: false, reason: "SEEK_FORWARD" });
  });
});

describe("§6 order: (1) credit → (2) bucket check → (3) quiz gate", () => {
  it("credit comes before the check: a TICK paid for by this event's own credit is accepted", () => {
    // Empty bank; 1 s of PLAYING since the last event refills 1.1 s, enough for a 1 s step.
    const r = applyClientEvents(playing({ furthestSec: 5, positionSec: 5, bankSec: 0 }), NO_QUIZ, [ev("TICK", 6)], at(1));
    expect(r.events[0].accepted).toBe(true);
    expect(r.session.furthestSec).toBe(6);
  });

  it("check comes before the gate: a TICK past triggerSec that the bank cannot pay → SPEED_EXCEEDED, no quiz", () => {
    const r = applyClientEvents(playing({ furthestSec: 12, positionSec: 12, bankSec: 0.5 }), VIDEO, [ev("TICK", 13.4)], at(0));
    expect(r.events[0].rejectReason).toBe("SPEED_EXCEEDED");
    expect(r.session).toMatchObject({ state: "PLAYING", currentQuestionId: null, positionSec: 12 });
  });

  it("a jump far past triggerSec is clamped to the gate before the bank check — a big raw jump behind a quiz is not itself a forward seek", () => {
    // furthest 12, trigger at 13: the clamp caps the cost at 1 (13 − 12), regardless of the raw 40.
    const r = applyClientEvents(playing({ furthestSec: 12, positionSec: 12, bankSec: 2 }), VIDEO, [ev("TICK", 40)], at(0));
    expect(r.session).toMatchObject({ state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13, currentQuestionId: "q1" });
    expect(r.session.bankSec).toBeCloseTo(1);
    expect(r.events[0].accepted).toBe(true);
  });

  it("the gate clamps to triggerSec; the bank pays for min(pos, triggerSec) − furthestSec, not the raw reported position", () => {
    const r = applyClientEvents(playing({ furthestSec: 12, positionSec: 12, bankSec: 2 }), VIDEO, [ev("TICK", 13.5)], at(0));
    expect(r.session).toMatchObject({ state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    expect(r.session.bankSec).toBeCloseTo(1); // cost = min(13.5, 13) − 12 = 1, not 13.5 − 12 = 1.5
  });

  it("a gate TICK at 14.0 with furthest 12.4 → QUIZ_PENDING, cost 0.6", () => {
    const r = applyClientEvents(playing({ furthestSec: 12.4, positionSec: 12.4, bankSec: 2 }), VIDEO, [ev("TICK", 14.0)], at(0));
    expect(r.session).toMatchObject({ state: "QUIZ_PENDING", positionSec: 13, furthestSec: 13 });
    expect(r.session.bankSec).toBeCloseTo(1.4); // cost = min(14.0, 13) − 12.4 = 0.6
  });
});

describe("§6.2 bank cap: rewatching or idling pre-pays at most 10 s of skip", () => {
  it("after a long rewatch the bank is at its 10 s max, and new ground stops at furthest + 10", () => {
    // 60 s of rewatching below furthest, crediting every 5 s.
    let s: SessionSnapshot = playing({ furthestSec: 20, positionSec: 0, bankSec: 3 });
    for (let t = 5; t <= 60; t += 5) s = applyClientEvents(s, NO_QUIZ, [ev("TICK", t / 4)], at(t)).session;
    expect(s.bankSec).toBe(10);
    expect(s.furthestSec).toBe(20);

    // Forged burst in one request (shared serverAt → no new credit): 2 s steps past furthest.
    const steps = [22, 24, 26, 28, 30, 32].map((p) => ev("TICK", p));
    const r = applyClientEvents(s, NO_QUIZ, steps, at(60));
    expect(r.events.map((e) => e.rejectReason)).toEqual([null, null, null, null, null, "SPEED_EXCEEDED"]);
    expect(r.session.furthestSec).toBe(30);
  });
});

describe("§6.2 checkSeek", () => {
  const s = session({ positionSec: 10, furthestSec: 20 });
  it("back or up to furthest: accepted as is", () => {
    expect(checkSeek(s, 3)).toEqual({ ok: true, positionSec: 3 });
    expect(checkSeek(s, 15)).toEqual({ ok: true, positionSec: 15 });
  });
  it("within 1.5 s past furthest: clamped to furthest", () => {
    expect(checkSeek(s, 21.5)).toEqual({ ok: true, positionSec: 20 });
  });
  it("beyond: SEEK_FORWARD", () => {
    expect(checkSeek(s, 21.51)).toEqual({ ok: false, reason: "SEEK_FORWARD" });
  });
});

describe("§6.3 quiz gate", () => {
  const questions = [
    { id: "late", triggerSec: 30 },
    { id: "early", triggerSec: 10 },
  ];
  it("fires at or after triggerSec only", () => {
    expect(quizGateAt(questions, [], 9.99)).toBeNull();
    expect(quizGateAt(questions, [], 10)?.id).toBe("early");
    expect(quizGateAt(questions, ["early"], 29)).toBeNull();
  });
  it("a passed question does not fire again on rewatch", () => {
    const r = applyClientEvents(
      playing({ passedQuestionIds: ["q1"], furthestSec: 20, positionSec: 12 }),
      VIDEO,
      [ev("TICK", 14)],
      at(1),
    );
    expect(r.session).toMatchObject({ state: "PLAYING", positionSec: 14 });
  });
});

describe("§5 soft-reject flagging", () => {
  const speeding = (s: SessionSnapshot, t: number): SessionSnapshot =>
    applyClientEvents(s, NO_QUIZ, [ev("TICK", s.furthestSec + 1.4)], at(t)).session;

  it("SPEED_EXCEEDED and NOT_WATCHED each add 1; flagged at 3, not before", () => {
    let s = playing({ furthestSec: 10, positionSec: 10, bankSec: 0 });
    s = speeding(s, 0);
    s = speeding(s, 0);
    expect(s).toMatchObject({ softRejectCount: 2, flagged: false });
    s = applyClientEvents(s, NO_QUIZ, [ev("ENDED", 10)], at(0)).session;
    expect(s).toMatchObject({ softRejectCount: 3, flagged: true });
  });

  it("QUIZ_REQUIRED, INVALID_TRANSITION and BATCH_ABORTED do not count", () => {
    const events: ClientEvent[] = [ev("TICK", 14), ev("SEEK", 1), ev("TICK", 15), ev("ENDED", 13)];
    const r = applyClientEvents(session({ state: "QUIZ_PENDING", currentQuestionId: "q1", furthestSec: 13 }), VIDEO, events, at(0));
    expect(r.events.map((e) => e.rejectReason)).toEqual(["QUIZ_REQUIRED", "BATCH_ABORTED", "BATCH_ABORTED", "INVALID_TRANSITION"]);
    expect(r.session).toMatchObject({ softRejectCount: 0, flagged: false });
  });

  it("SEEK_FORWARD flags at once, from TICK or SEEK", () => {
    expect(applyClientEvents(playing(), NO_QUIZ, [ev("SEEK", 5)], at(0)).session.flagged).toBe(true);
    // TICK has no +1.5 s slack (only SEEK does); it flags once need exceeds the 10 s bank max.
    expect(applyClientEvents(playing(), NO_QUIZ, [ev("TICK", 11)], at(0)).session.flagged).toBe(true);
  });
});
