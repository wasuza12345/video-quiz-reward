import { describe, expect, it } from "vitest";
import { buildRows, detailSummary, eventBorder, findFlagTriggerEventId } from "@/frontend/admin/components/SessionTimeline";
import type { AdminSessionEventRow } from "@/shared/contracts/admin";

function event(overrides: Partial<AdminSessionEventRow> & { id: number }): AdminSessionEventRow {
  return {
    seq: overrides.id,
    type: "TICK",
    positionSec: 0,
    clientAt: null,
    serverAt: new Date(2026, 0, 1, 0, 0, overrides.id).toISOString(),
    accepted: true,
    rejectReason: null,
    fromState: "PLAYING",
    toState: "PLAYING",
    payload: null,
    ...overrides,
  };
}

describe("findFlagTriggerEventId (spec §5.7: first SEEK_FORWARD, or the 3rd soft reject)", () => {
  it("returns null when nothing is rejected", () => {
    expect(findFlagTriggerEventId([event({ id: 1 })])).toBeNull();
  });

  it("returns the first SEEK_FORWARD event, ignoring later rejects", () => {
    const events = [
      event({ id: 1 }),
      event({ id: 2, accepted: false, rejectReason: "SEEK_FORWARD" }),
      event({ id: 3, accepted: false, rejectReason: "SEEK_FORWARD" }),
    ];
    expect(findFlagTriggerEventId(events)).toBe(2);
  });

  it("does not trigger on the 1st or 2nd soft reject", () => {
    const events = [event({ id: 1, accepted: false, rejectReason: "SPEED_EXCEEDED" }), event({ id: 2, accepted: false, rejectReason: "NOT_WATCHED" })];
    expect(findFlagTriggerEventId(events)).toBeNull();
  });

  it("triggers on exactly the 3rd soft reject, mixing SPEED_EXCEEDED and NOT_WATCHED", () => {
    const events = [
      event({ id: 1, accepted: false, rejectReason: "SPEED_EXCEEDED" }),
      event({ id: 2, accepted: false, rejectReason: "NOT_WATCHED" }),
      event({ id: 3, accepted: false, rejectReason: "SPEED_EXCEEDED" }),
      event({ id: 4, accepted: false, rejectReason: "SPEED_EXCEEDED" }), // already flagged by #3, not the trigger
    ];
    expect(findFlagTriggerEventId(events)).toBe(3);
  });

  it("benign reject reasons never trigger the flag", () => {
    const events = [
      event({ id: 1, accepted: false, rejectReason: "QUIZ_REQUIRED" }),
      event({ id: 2, accepted: false, rejectReason: "BATCH_ABORTED" }),
      event({ id: 3, accepted: false, rejectReason: "INVALID_TRANSITION" }),
    ];
    expect(findFlagTriggerEventId(events)).toBeNull();
  });

  it("sorts by serverAt before scanning, independent of array order", () => {
    const early = event({ id: 5, accepted: false, rejectReason: "SEEK_FORWARD", serverAt: new Date(2026, 0, 1, 0, 0, 1).toISOString() });
    const late = event({ id: 6, accepted: false, rejectReason: "SEEK_FORWARD", serverAt: new Date(2026, 0, 1, 0, 0, 9).toISOString() });
    expect(findFlagTriggerEventId([late, early])).toBe(5);
  });
});

describe("buildRows (spec §5.7: consecutive accepted TICKs collapse; rejected TICKs never collapse)", () => {
  it("collapses a run of 3+ consecutive accepted TICKs into one tick-group row", () => {
    const events = [event({ id: 1, type: "PLAY" }), event({ id: 2 }), event({ id: 3 }), event({ id: 4 }), event({ id: 5, type: "ENDED" })];
    const rows = buildRows(events, false, true);
    expect(rows.map((r) => r.kind)).toEqual(["event", "tick-group", "event"]);
    expect(rows[1]).toMatchObject({ kind: "tick-group", events: [events[1], events[2], events[3]] });
  });

  it("leaves a lone TICK ungrouped (no point collapsing a group of one)", () => {
    const events = [event({ id: 1, type: "PLAY" }), event({ id: 2 }), event({ id: 3, type: "PAUSE" })];
    const rows = buildRows(events, false, true);
    expect(rows.map((r) => r.kind)).toEqual(["event", "event", "event"]);
  });

  it("never collapses a rejected TICK, even mid-run — it splits the surrounding runs into separate groups", () => {
    const events = [event({ id: 1 }), event({ id: 2 }), event({ id: 3, accepted: false, rejectReason: "SPEED_EXCEEDED" }), event({ id: 4 }), event({ id: 5 })];
    const rows = buildRows(events, false, true);
    expect(rows.map((r) => r.kind)).toEqual(["tick-group", "event", "tick-group"]);
    expect(rows[1]).toMatchObject({ kind: "event", event: events[2] });
  });

  it("collapseTicks=false returns one row per event, unmodified order", () => {
    const events = [event({ id: 1 }), event({ id: 2 }), event({ id: 3 })];
    const rows = buildRows(events, false, false);
    expect(rows).toEqual(events.map((e) => ({ kind: "event", event: e })));
  });

  it("onlyRejected filters to rejected events before grouping", () => {
    const events = [event({ id: 1 }), event({ id: 2, accepted: false, rejectReason: "NOT_WATCHED" }), event({ id: 3 })];
    const rows = buildRows(events, true, true);
    expect(rows).toEqual([{ kind: "event", event: events[1] }]);
  });
});

describe("detailSummary (spec §5.7: ANSWER 'ตอบ B · ถูก/ผิด', CLAIM '+50' / '0')", () => {
  it("summarises a correct ANSWER", () => {
    const e = event({ id: 1, type: "ANSWER", payload: JSON.stringify({ questionId: "q1", choice: "D", correct: true }) });
    expect(detailSummary(e)).toBe("ตอบ D · ถูก");
  });

  it("summarises an incorrect ANSWER", () => {
    const e = event({ id: 1, type: "ANSWER", payload: JSON.stringify({ questionId: "q1", choice: "A", correct: false }) });
    expect(detailSummary(e)).toBe("ตอบ A · ผิด");
  });

  it("summarises an awarded CLAIM", () => {
    const e = event({ id: 1, type: "CLAIM", payload: JSON.stringify({ awarded: true, points: 50 }) });
    expect(detailSummary(e)).toBe("+50");
  });

  it("summarises a non-awarded CLAIM (replay)", () => {
    const e = event({ id: 1, type: "CLAIM", payload: JSON.stringify({ awarded: false, points: 0 }) });
    expect(detailSummary(e)).toBe("0");
  });

  it("returns an empty string when there is no payload", () => {
    expect(detailSummary(event({ id: 1, type: "PLAY", payload: null }))).toBe("");
  });

  it("returns an empty string instead of throwing on malformed payload JSON", () => {
    expect(detailSummary(event({ id: 1, type: "ANSWER", payload: "{not json" }))).toBe("");
  });
});

describe("eventBorder (spec §5.7 row highlighting)", () => {
  it("flag-worthy rejects get a 4px danger border", () => {
    expect(eventBorder(event({ id: 1, accepted: false, rejectReason: "SEEK_FORWARD" }))).toBe("4px solid var(--danger)");
  });

  it("benign rejects get no special border", () => {
    expect(eventBorder(event({ id: 1, accepted: false, rejectReason: "QUIZ_REQUIRED" }))).toBeUndefined();
  });

  it("a state change into QUIZ_PENDING gets a 2px navy rule", () => {
    expect(eventBorder(event({ id: 1, fromState: "PLAYING", toState: "QUIZ_PENDING" }))).toBe("2px solid var(--brand-primary)");
  });

  it("a state change into ENDED gets a 2px navy rule", () => {
    expect(eventBorder(event({ id: 1, fromState: "PLAYING", toState: "ENDED" }))).toBe("2px solid var(--brand-primary)");
  });

  it("a state change elsewhere (e.g. CREATED -> PLAYING) gets no rule", () => {
    expect(eventBorder(event({ id: 1, fromState: "CREATED", toState: "PLAYING" }))).toBeUndefined();
  });
});
