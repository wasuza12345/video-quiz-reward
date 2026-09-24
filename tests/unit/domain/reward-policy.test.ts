import { describe, expect, it } from "vitest";
import { canEnd, decideClaim } from "@/backend/domain/reward-policy";
import { NO_QUIZ, VIDEO } from "./fixtures";

describe("§6.4 canEnd (44 s video, one question)", () => {
  const ok = { passedQuestionIds: ["q1"], furthestSec: 42, playedWallSec: 39.6 };

  it("true at the exact boundaries: furthest ≥ duration − 2, played ≥ 0.9 × duration, all passed", () => {
    expect(canEnd(ok, VIDEO)).toBe(true);
  });
  it("false when a question is not passed", () => {
    expect(canEnd({ ...ok, passedQuestionIds: [] }, VIDEO)).toBe(false);
  });
  it("false when furthest is short of duration − 2", () => {
    expect(canEnd({ ...ok, furthestSec: 41.9 }, VIDEO)).toBe(false);
  });
  it("false when played time is short of 0.9 × duration", () => {
    expect(canEnd({ ...ok, playedWallSec: 39.5 }, VIDEO)).toBe(false);
  });
  it("a video without questions needs only furthest + played", () => {
    expect(canEnd({ ...ok, passedQuestionIds: [] }, NO_QUIZ)).toBe(true);
  });
});

describe("§5 CLAIM (ENDED + CLAIM)", () => {
  it("not ENDED → NOT_ENDED", () => {
    for (const state of ["CREATED", "PLAYING", "PAUSED", "QUIZ_PENDING"] as const) {
      expect(decideClaim({ state, isReplay: false }, false, 50)).toEqual({ ok: false, code: "NOT_ENDED" });
    }
  });
  it("ENDED, not replay, not yet rewarded → award the video's points", () => {
    expect(decideClaim({ state: "ENDED", isReplay: false }, false, 50)).toEqual({ ok: true, award: true, points: 50 });
  });
  it("ENDED replay → awarded: false (not an error)", () => {
    expect(decideClaim({ state: "ENDED", isReplay: true }, false, 50)).toEqual({ ok: true, award: false });
  });
  it("ENDED but the video is already rewarded → awarded: false", () => {
    expect(decideClaim({ state: "ENDED", isReplay: false }, true, 50)).toEqual({ ok: true, award: false });
  });
});
