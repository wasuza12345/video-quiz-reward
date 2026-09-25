import { describe, expect, it } from "vitest";
import { WatchTracker } from "@/frontend/public/hooks/watch-tracker-core";
import type { PublicQuestion } from "@/shared/contracts/session";

const Q1: PublicQuestion = { id: "q1", triggerSec: 13, prompt: "?", choices: [] };
const QUIZZES = [Q1];

describe("WatchTracker.onFrame — anti-cheat per-frame checks (plan §6)", () => {
  it("honest playback (current tracking the high-water mark, below the trigger) does nothing", () => {
    const t = new WatchTracker(5);
    expect(t.onFrame(5, 0.016, QUIZZES, [])).toEqual({ kind: "none" });
    expect(t.onFrame(5.2, 0.016, QUIZZES, [])).toEqual({ kind: "none" }); // within the advance threshold
  });

  it("a jump beyond the 1.5s slack → seek guard snaps back to the high-water mark", () => {
    const t = new WatchTracker(5);
    const d = t.onFrame(6.6, 0.016, QUIZZES, []);
    expect(d).toEqual({ kind: "seek_guard", seekTo: 5 });
    expect(t.maxReached).toBe(5); // unchanged by a rejected frame
  });

  it("reaching the trigger opens the gate for that question", () => {
    const t = new WatchTracker(13);
    expect(t.onFrame(13, 0.016, QUIZZES, [])).toEqual({ kind: "gate", questionId: "q1", triggerSec: 13 });
  });

  it("a passed question's trigger does not re-open the gate", () => {
    const t = new WatchTracker(13);
    expect(t.onFrame(13, 0.016, QUIZZES, ["q1"])).toEqual({ kind: "none" });
  });

  it("the seek guard takes priority over the gate on the same frame", () => {
    const t = new WatchTracker(5);
    expect(t.onFrame(20, 0.016, QUIZZES, [])).toEqual({ kind: "seek_guard", seekTo: 5 });
  });

  it("no quizzes at all: never gates, only the seek guard can fire", () => {
    const t = new WatchTracker(30);
    expect(t.onFrame(30, 0.016, [], [])).toEqual({ kind: "none" });
    expect(t.onFrame(32, 0.016, [], [])).toEqual({ kind: "seek_guard", seekTo: 30 });
  });

  it("a backward seek (rewatching) never lowers the high-water mark by itself", () => {
    const t = new WatchTracker(10);
    t.onFrame(2, 0.016, [], []); // user rewinds
    expect(t.maxReached).toBe(10);
  });

  it("reconcile() forces the high-water mark to an exact value (used on rejection/conflict/gate-fallback/ended-fallback)", () => {
    const t = new WatchTracker(10);
    t.onFrame(10.1, 0.016, [], []); // advances a little
    t.reconcile(3);
    expect(t.maxReached).toBe(3);
    // and the guard now measures from the reconciled value, not the pre-reconcile one
    expect(t.onFrame(5, 0.016, [], [])).toEqual({ kind: "seek_guard", seekTo: 3 });
  });
});

describe("WatchTracker.noteSettled — trust a confirmed PAUSED/genuine-PLAYING position outright", () => {
  it("raises the high-water mark to the settled position, then honest playback from there advances normally with no seek_guard", () => {
    const t = new WatchTracker(6.91);
    t.noteSettled(7.18); // e.g. the PLAYING read revealing the ~0.27s pause-settle creep
    expect(t.maxReached).toBe(7.18);

    const d = t.onFrame(7.3, 0.016, [], []);
    expect(d).toEqual({ kind: "none" });
    expect(t.maxReached).toBeCloseTo(7.3, 5);
  });

  it("does not lift the mark past SEEK_GUARD_SLACK_SEC — a devtools seek while paused still can't use this to escape the guard", () => {
    const t = new WatchTracker(6.91);
    t.noteSettled(6.91 + 5); // far beyond the 1.5s slack
    expect(t.maxReached).toBe(6.91);
  });

  it("never lowers the high-water mark (a settled position reported behind it is simply ignored)", () => {
    const t = new WatchTracker(10);
    t.noteSettled(4);
    expect(t.maxReached).toBe(10);
  });

  it("replays the real production sequence (round 2 regression): the PAUSED read is itself stale, the drift only shows at the next PLAYING", () => {
    // dev.db session 5556d645, cycle 1: PAUSE reports 2.28 (stale — matches maxReached already),
    // the resume's PLAYING reports 2.54 (the ~0.26s creep, revealed only now) — noteSettled at
    // BOTH call sites is what makes this a no-op instead of a stuck middle-band gap.
    const t = new WatchTracker(2.28);
    t.noteSettled(2.28); // the PAUSED call — no-op, already at the mark
    expect(t.maxReached).toBe(2.28);
    t.noteSettled(2.54); // the PLAYING call — this is the one that actually has to do the lifting
    expect(t.maxReached).toBe(2.54);

    const d = t.onFrame(2.6, 0.016, [], []);
    expect(d).toEqual({ kind: "none" });
  });
});

describe("WatchTracker — rAF gap and drag tolerance", () => {
  it("a 1.2s rAF gap is accepted as an advance, not snapped back", () => {
    const t = new WatchTracker(10);
    const d = t.onFrame(11.2, 1.2, [], []); // frameDtSec=1.2 → advanceThreshold = max(0.25, 2.4) = 2.4
    expect(d).toEqual({ kind: "none" });
    expect(t.maxReached).toBe(11.2);
  });

  it("a user drag of +10s at a normal frame rate is snapped back", () => {
    const t = new WatchTracker(10);
    const d = t.onFrame(20, 0.016, [], []);
    expect(d).toEqual({ kind: "seek_guard", seekTo: 10 });
    expect(t.maxReached).toBe(10);
  });
});

describe("WatchTracker — 20s of honest 1× playback with periodic server syncs (plan §6)", () => {
  /**
   * This is the exact bug found in production: the seek guard
   * compared against the reducer's server-synced furthestSec, which only moved every ~5s (and,
   * separately, never moved at all for a new session because accepted responses were never
   * dispatched anywhere — see EVENTS_SYNCED in watch.reducer.ts). A quick reproduction of that
   * exact old formula (see /tmp reproduction script, not part of this codebase) against this same
   * 20s honest-playback sequence: the seek guard fires 13 times and playback never gets past
   * ~1.5s. `WatchTracker` fixes this by tracking its OWN local high-water mark every frame,
   * reconciled down only by explicit server corrections — never by silently going stale.
   */
  it("zero seek_guard decisions over 20s, and the gate fires exactly once at the trigger", () => {
    const tracker = new WatchTracker(0);
    let simulatedTime = 0;
    const passed: string[] = [];
    const seekGuards: unknown[] = [];
    const gates: unknown[] = [];

    // One rAF frame every 16ms (60fps) for 20 simulated seconds of honest 1x playback.
    for (let ms = 16; ms <= 20_000; ms += 16) {
      simulatedTime += 0.016; // 1x playback: real time elapsed == video time elapsed
      const decision = tracker.onFrame(simulatedTime, 0.016, QUIZZES, passed);
      if (decision.kind === "seek_guard") seekGuards.push(decision);
      if (decision.kind === "gate") {
        gates.push(decision);
        passed.push(decision.questionId); // simulate answering immediately so it doesn't re-gate
      }

      // A server sync every ~5s (plan §4.2's flush cadence) reporting an ACCEPTED, honest
      // furthestSec at or ahead of what the tracker already knows — this must never regress it.
      if (ms % 5000 === 0) tracker.reconcile(Math.max(tracker.maxReached, simulatedTime));
    }

    expect(seekGuards).toEqual([]);
    expect(gates).toHaveLength(1);
    expect((gates[0] as { triggerSec: number }).triggerSec).toBe(13);
  });
});
