import { describe, expect, it } from "vitest";
import { decideFrame } from "@/frontend/public/hooks/watch-tracker-core";
import type { PublicQuestion } from "@/shared/contracts/session";

const Q1: PublicQuestion = { id: "q1", triggerSec: 13, prompt: "?", choices: [] };
const QUIZZES = [Q1];

describe("decideFrame — anti-cheat per-frame checks (plan §6)", () => {
  it("honest playback (current tracking furthest, below the trigger) does nothing", () => {
    expect(decideFrame({ currentTime: 5, furthestSec: 5, quizzes: QUIZZES, passedQuestionIds: [] })).toEqual({ kind: "none" });
    expect(decideFrame({ currentTime: 6.4, furthestSec: 5, quizzes: QUIZZES, passedQuestionIds: [] })).toEqual({ kind: "none" }); // within the 1.5s slack
  });

  it("current > furthest + 1.5 → seek guard snaps back to furthest", () => {
    const d = decideFrame({ currentTime: 6.6, furthestSec: 5, quizzes: QUIZZES, passedQuestionIds: [] });
    expect(d).toEqual({ kind: "seek_guard", seekTo: 5 });
  });

  it("reaching the trigger opens the gate for that question", () => {
    const d = decideFrame({ currentTime: 13, furthestSec: 13, quizzes: QUIZZES, passedQuestionIds: [] });
    expect(d).toEqual({ kind: "gate", questionId: "q1", triggerSec: 13 });
  });

  it("a passed question's trigger does not re-open the gate", () => {
    const d = decideFrame({ currentTime: 13, furthestSec: 13, quizzes: QUIZZES, passedQuestionIds: ["q1"] });
    expect(d).toEqual({ kind: "none" });
  });

  it("the seek guard takes priority over the gate on the same frame", () => {
    // furthest is far behind current, past the trigger too — should snap back, not open the gate.
    const d = decideFrame({ currentTime: 20, furthestSec: 5, quizzes: QUIZZES, passedQuestionIds: [] });
    expect(d).toEqual({ kind: "seek_guard", seekTo: 5 });
  });

  it("no quizzes at all: never gates, only the seek guard can fire", () => {
    expect(decideFrame({ currentTime: 30, furthestSec: 30, quizzes: [], passedQuestionIds: [] })).toEqual({ kind: "none" });
    expect(decideFrame({ currentTime: 32, furthestSec: 30, quizzes: [], passedQuestionIds: [] })).toEqual({ kind: "seek_guard", seekTo: 30 });
  });
});

describe("decideFrame — a realistic honest-viewer frame sequence from a fake player", () => {
  class FakePlayer {
    time = 0;
    advance(sec: number) {
      this.time += sec;
      return this.time;
    }
  }

  it("an honest 1× viewer never trips the seek guard and gates exactly once at the trigger", () => {
    const player = new FakePlayer();
    let furthestSec = 0;
    let passedQuestionIds: string[] = [];
    const gateHits: string[] = [];
    const seekGuards: number[] = [];

    // 20 frames of honest playback, ~0.7s apart, crossing the trigger at 13s.
    for (let i = 0; i < 20; i++) {
      const currentTime = player.advance(0.7);
      const decision = decideFrame({ currentTime, furthestSec, quizzes: QUIZZES, passedQuestionIds });
      if (decision.kind === "seek_guard") {
        seekGuards.push(decision.seekTo);
        furthestSec = decision.seekTo;
      } else if (decision.kind === "gate") {
        gateHits.push(decision.questionId);
        passedQuestionIds = [...passedQuestionIds, decision.questionId]; // simulate answering immediately
        furthestSec = decision.triggerSec;
      } else {
        furthestSec = Math.max(furthestSec, currentTime);
      }
    }

    expect(seekGuards).toEqual([]);
    expect(gateHits).toEqual(["q1"]); // fires once, not on every subsequent frame past the trigger
  });
});
