// Whole-session simulations through the pure domain: a client batching TICKs every 5 s
// (1 TICK per wall second), as in plan §4.2, against the brief video (44 s, quiz at 0:13).
import { describe, expect, it, vi } from "vitest";
import { applyAnswer, applyClientEvents } from "@/backend/domain/session-state-machine";
import { canEnd, decideClaim } from "@/backend/domain/reward-policy";
import type { ClientEvent, EventRecord, SessionSnapshot } from "@/backend/domain/types";
import { TOLERANCES } from "@/shared/constants/session";
import { at, ev, session, VIDEO } from "./fixtures";

const Q1 = { id: "q1", correctChoice: "D", labels: ["A", "B", "C", "D"] };

class Sim {
  s: SessionSnapshot = session();
  log: EventRecord[] = [];
  send(events: ClientEvent[], wallSec: number) {
    const r = applyClientEvents(this.s, VIDEO, events, at(wallSec));
    this.s = r.session;
    this.log.push(...r.events);
    return r.events;
  }
  answer(choice: string) {
    const r = applyAnswer(this.s, Q1, choice);
    if (!r.ok) throw new Error(r.code);
    this.s = r.session;
    return r.correct;
  }
  rejected() {
    return this.log.filter((e) => !e.accepted).map((e) => e.rejectReason);
  }
}

/** Honest 1× playback from `fromPos` for `seconds` of wall time starting at `wall`; flushes every 5 s. */
function watch(sim: Sim, wall: number, fromPos: number, seconds: number, rate = 1) {
  let batch: ClientEvent[] = [];
  for (let i = 1; i <= seconds; i++) {
    batch.push(ev("TICK", Math.min(fromPos + i * rate, VIDEO.durationSec)));
    if (i % 5 === 0 || i === seconds) {
      sim.send(batch, wall + i);
      batch = [];
    }
  }
  return wall + seconds;
}

describe("scenarios", () => {
  it("honest viewer: play → quiz at 0:13 (wrong, then right) → play to the end → ENDED → claim +50 once", () => {
    const sim = new Sim();
    sim.send([ev("PLAY", 0)], 0);
    let wall = watch(sim, 0, 0, 12); // 0..12
    // Quiz gate: client pauses at 13.2, sends TICK then PAUSE immediately.
    sim.send([ev("TICK", 13.2), ev("PAUSE", 13.2)], wall + 1.2);
    expect(sim.s).toMatchObject({ state: "QUIZ_PENDING", positionSec: 13, currentQuestionId: "q1" });

    expect(sim.answer("C")).toBe(false);
    expect(sim.s.state).toBe("QUIZ_PENDING");
    expect(sim.answer("D")).toBe(true);
    expect(sim.s).toMatchObject({ state: "PAUSED", passedQuestionIds: ["q1"] });

    wall += 20; // time spent on the quiz is not PLAYING time
    sim.send([ev("PLAY", 13)], wall);
    wall = watch(sim, wall, 13, 31); // 13..44
    expect(sim.s.furthestSec).toBe(44);
    sim.send([ev("ENDED", 44)], wall);

    expect(sim.rejected()).toEqual([]);
    expect(sim.s.state).toBe("ENDED");
    expect(sim.s.flagged).toBe(false);
    expect(sim.s.playedWallSec).toBeGreaterThanOrEqual(VIDEO.durationSec * TOLERANCES.MIN_PLAYED_RATIO);
    expect(decideClaim(sim.s, false, 50)).toEqual({ ok: true, award: true, points: 50 });
    expect(decideClaim(sim.s, true, 50)).toEqual({ ok: true, award: false }); // second claim
  });

  // Content is decoupled from arrival: every batch carries exactly 5 s of video (five 1-s
  // TICKs), regardless of how far apart in real (wall-clock) time the batches land. This is
  // what actually exercises the bank as slack for irregular network timing — a version that
  // advances position by the arrival gap itself would pass for (almost) any positive cap.
  const JITTER_GAPS = [4, 4.5, 4, 6, 5.5];

  function jitteredPlayTo(sim: Sim, gapState: { i: number; wall: number }, target: number) {
    let pos = sim.s.positionSec;
    while (pos < target) {
      gapState.wall += JITTER_GAPS[gapState.i++ % JITTER_GAPS.length];
      const steps = Math.min(5, target - pos);
      const batch = Array.from({ length: steps }, (_, k) => ev("TICK", pos + k + 1));
      sim.send(batch, gapState.wall);
      pos = sim.s.positionSec;
    }
  }

  it("honest viewer with jittered batch arrivals (5 s of content/batch, arriving every 4–6 s) gets 0 rejections and +50", () => {
    const sim = new Sim();
    sim.send([ev("PLAY", 0)], 0);
    const gapState = { i: 0, wall: 0 };

    jitteredPlayTo(sim, gapState, 13);
    expect(sim.s).toMatchObject({ state: "QUIZ_PENDING", positionSec: 13, currentQuestionId: "q1" });
    expect(sim.answer("D")).toBe(true);

    gapState.wall += 5; // time spent on the quiz is not PLAYING time
    sim.send([ev("PLAY", 13)], gapState.wall);
    jitteredPlayTo(sim, gapState, 44);
    sim.send([ev("ENDED", 44)], gapState.wall);

    expect(sim.rejected()).toEqual([]);
    expect(sim.s.state).toBe("ENDED");
    expect(sim.s.flagged).toBe(false);
    expect(decideClaim(sim.s, false, 50)).toEqual({ ok: true, award: true, points: 50 });
  });

  it("control: the same jittered sequence starves under the old BANK_MAX_SEC = 6 — pins the cap at 10", async () => {
    // Re-imports the real domain with TOLERANCES.BANK_MAX_SEC mocked to the pre-v5.2 value,
    // so this exercises the actual checkTick/creditPlayTime code path, not a re-implementation.
    vi.resetModules();
    vi.doMock("@/shared/constants/session", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/shared/constants/session")>();
      return { ...actual, TOLERANCES: { ...actual.TOLERANCES, BANK_MAX_SEC: 6 } };
    });
    try {
      const { applyClientEvents: applyWithCap6 } = await import("@/backend/domain/session-state-machine");
      const { session: mkSession, ev: mkEv, at: mkAt, NO_QUIZ: mkNoQuiz } = await import("./fixtures");

      let s = mkSession({ state: "PLAYING", lastPlayingAt: mkAt(0) });
      let wall = 0;
      let sawRejection = false;
      for (let i = 0; i < JITTER_GAPS.length * 3 && !sawRejection && s.positionSec < mkNoQuiz.durationSec; i++) {
        wall += JITTER_GAPS[i % JITTER_GAPS.length];
        const pos = s.positionSec;
        const steps = Math.min(5, mkNoQuiz.durationSec - pos);
        const batch = Array.from({ length: steps }, (_, k) => mkEv("TICK", pos + k + 1));
        const r = applyWithCap6(s, mkNoQuiz, batch, mkAt(wall));
        s = r.session;
        if (r.events.some((e) => !e.accepted)) sawRejection = true;
      }

      expect(sawRejection).toBe(true);
    } finally {
      vi.doUnmock("@/shared/constants/session");
      vi.resetModules();
    }
  });

  it("setPlaybackRate(2): outruns the bank → SPEED_EXCEEDED, flagged at the 3rd soft reject, cannot end early", () => {
    const sim = new Sim();
    sim.s = session({ passedQuestionIds: ["q1"] }); // even with the quiz out of the way
    sim.send([ev("PLAY", 0)], 0);
    const wall = watch(sim, 0, 0, 22, 2); // 22 s of wall time would reach 44 at 2×

    // Each individual TICK only advances 2 s (never > BANK_MAX_SEC on its own), so the run
    // starts by draining the bank into soft SPEED_EXCEEDED rejects — flagging by the 3rd —
    // before the client's ever-climbing reported position outruns the stalled furthestSec
    // by more than the bank can ever hold, which then also trips the hard SEEK_FORWARD.
    expect(sim.rejected()).toContain("SPEED_EXCEEDED");
    expect(sim.s.flagged).toBe(true);
    expect(sim.s.softRejectCount).toBeGreaterThanOrEqual(TOLERANCES.SOFT_REJECT_FLAG_AT);
    expect(sim.s.furthestSec).toBeLessThan(VIDEO.durationSec - TOLERANCES.END_SLACK_SEC);
    const [end] = sim.send([ev("ENDED", 44)], wall);
    expect(end.rejectReason).toBe("NOT_WATCHED");
  });

  it("1.4× playback (steps inside the slack): the bank runs dry → SPEED_EXCEEDED, progress ≈ 1.1×", () => {
    const sim = new Sim();
    sim.s = session({ passedQuestionIds: ["q1"] });
    sim.send([ev("PLAY", 0)], 0);
    const wall = watch(sim, 0, 0, 30, 1.4); // 30 s wall would reach 42 at 1.4×

    expect(sim.rejected()).toContain("SPEED_EXCEEDED");
    expect(sim.s.furthestSec).toBeLessThanOrEqual(30 * TOLERANCES.BANK_RATE + TOLERANCES.BANK_INITIAL_SEC);
    const [end] = sim.send([ev("ENDED", 44)], wall);
    expect(end.rejectReason).toBe("NOT_WATCHED");
    expect(canEnd(sim.s, VIDEO)).toBe(false);
  });

  it("rewatch then skip 20 s: the bank covers at most 10 s, the skip is rejected", () => {
    const sim = new Sim();
    sim.s = session({ passedQuestionIds: ["q1"] });
    sim.send([ev("PLAY", 0)], 0);
    let wall = watch(sim, 0, 0, 20); // honest to 20
    sim.send([ev("SEEK", 0)], wall);
    wall = watch(sim, wall, 0, 20); // rewatch 0..20 (free), bank fills to the max
    expect(sim.s.bankSec).toBe(TOLERANCES.BANK_MAX_SEC);

    const [seek] = sim.send([ev("SEEK", 40)], wall + 1);
    const [tick] = sim.send([ev("TICK", 40)], wall + 2);
    expect(seek.rejectReason).toBe("SEEK_FORWARD");
    expect(tick.rejectReason).toBe("SEEK_FORWARD");
    expect(sim.s).toMatchObject({ furthestSec: 20, flagged: true });
  });

  it("forged batch: 44 s of TICKs in one request after 5 s of play is rejected after the bank runs out", () => {
    const sim = new Sim();
    sim.s = session({ passedQuestionIds: ["q1"] });
    sim.send([ev("PLAY", 0)], 0);
    const forged = Array.from({ length: 44 }, (_, i) => ev("TICK", i + 1));
    const results = sim.send([...forged, ev("ENDED", 44)], 5);

    expect(sim.s.furthestSec).toBeLessThanOrEqual(5 * TOLERANCES.BANK_RATE + TOLERANCES.BANK_INITIAL_SEC);
    expect(results.at(-1)?.rejectReason).toBe("NOT_WATCHED");
    expect(results.filter((r) => r.rejectReason === "BATCH_ABORTED").length).toBeGreaterThan(30);
    expect(sim.s.state).toBe("PLAYING");
  });

  it("a lost PAUSE (tab closed) credits at most 10 s on the next event", () => {
    const sim = new Sim();
    sim.send([ev("PLAY", 0)], 0);
    watch(sim, 0, 0, 5);
    sim.send([ev("PLAY", 5)], 3600); // an hour later, no PAUSE was received
    expect(sim.s.playedWallSec).toBe(5 + TOLERANCES.CREDIT_CAP_SEC);
  });
});
