// buildFlagReason must share SOFT_REJECT_REASONS with the server's own softRejectCount
// (shared/constants/session.ts) rather than hardcoding its own soft-reject set: NOT_WATCHED can
// legitimately fire many times for one honest ENDED-recovery retry loop and must never count
// toward "ถูกปฏิเสธสะสม".
import { describe, expect, it } from "vitest";
import { buildFlagReason } from "@/frontend/admin/pages/AdminSessionDetailPage";
import type { AdminSessionEventRow } from "@/shared/contracts/admin";

function event(over: Partial<AdminSessionEventRow>): AdminSessionEventRow {
  return {
    id: 1,
    seq: 1,
    type: "ENDED",
    positionSec: 0,
    clientAt: null,
    serverAt: new Date().toISOString(),
    accepted: false,
    rejectReason: null,
    fromState: "PLAYING",
    toState: "PLAYING",
    payload: null,
    ...over,
  };
}

describe("buildFlagReason", () => {
  it("3x NOT_WATCHED alone gives an empty-count reason, never blaming it as a soft reject", () => {
    const events = [
      event({ rejectReason: "NOT_WATCHED" }),
      event({ rejectReason: "NOT_WATCHED" }),
      event({ rejectReason: "NOT_WATCHED" }),
    ];
    expect(buildFlagReason(events)).toBe("ถูกปฏิเสธสะสม 0 ครั้ง (เร็วผิดปกติ 0)");
  });

  it("counts SPEED_EXCEEDED but not NOT_WATCHED when both are present", () => {
    const events = [
      event({ rejectReason: "SPEED_EXCEEDED" }),
      event({ rejectReason: "NOT_WATCHED" }),
      event({ rejectReason: "NOT_WATCHED" }),
    ];
    expect(buildFlagReason(events)).toBe("ถูกปฏิเสธสะสม 1 ครั้ง (เร็วผิดปกติ 1)");
  });

  it("still leads with SEEK_FORWARD when present, regardless of other reject reasons", () => {
    const events = [event({ rejectReason: "SEEK_FORWARD" }), event({ rejectReason: "SPEED_EXCEEDED" })];
    expect(buildFlagReason(events)).toContain("ข้ามไปข้างหน้า");
  });

  it("ignores accepted events even if they carry a leftover rejectReason field", () => {
    const events = [event({ accepted: true, rejectReason: "SPEED_EXCEEDED" })];
    expect(buildFlagReason(events)).toBe("ถูกปฏิเสธสะสม 0 ครั้ง (เร็วผิดปกติ 0)");
  });
});
