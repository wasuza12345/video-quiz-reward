import { describe, expect, it } from "vitest";
import { applyResume, decideResume, type ExistingSession } from "@/backend/domain/resume-policy";
import type { SessionState } from "@/shared/constants/session";
import { at, playing, session } from "./fixtures";

const row = (id: string, startedSec: number, over: Partial<ExistingSession> = {}): ExistingSession => ({
  id,
  isReplay: false,
  state: "PAUSED",
  startedAt: at(startedSec),
  rewarded: false,
  ...over,
});

describe("§4.3 decideResume", () => {
  it("rule 1: never resumes a rewarded session", () => {
    const sessions = [row("won", 10, { state: "ENDED", rewarded: true })];
    expect(decideResume("published", sessions, true)).toEqual({ action: "create", isReplay: true });
  });

  it("rule 2: not rewarded → resumes the newest session, whatever the input order", () => {
    const sessions = [row("old", 1), row("new", 9, { state: "PLAYING" }), row("mid", 5)];
    expect(decideResume("published", sessions, false)).toEqual({ action: "resume", sessionId: "new" });
  });

  it.each<SessionState>(["CREATED", "PLAYING", "PAUSED", "QUIZ_PENDING", "ENDED"])(
    "rule 2: not rewarded → resumes the newest session in state %s (ENDED → client auto-claims)",
    (state) => {
      expect(decideResume("published", [row("s", 1, { state })], false)).toEqual({ action: "resume", sessionId: "s" });
    },
  );

  it("rule 2: not rewarded and no session → create isReplay=false", () => {
    expect(decideResume("published", [], false)).toEqual({ action: "create", isReplay: false });
  });

  it("rule 3: rewarded → resumes the newest replay session that is not ENDED", () => {
    const sessions = [
      row("won", 1, { state: "ENDED", rewarded: true }),
      row("replay-old", 2, { isReplay: true, state: "ENDED" }),
      row("replay-new", 3, { isReplay: true, state: "QUIZ_PENDING" }),
    ];
    expect(decideResume("published", sessions, true)).toEqual({ action: "resume", sessionId: "replay-new" });
  });

  it("rule 3: rewarded and the newest replay has ENDED → create a new replay (older open replays are not revived)", () => {
    const sessions = [
      row("won", 1, { state: "ENDED", rewarded: true }),
      row("replay-open", 2, { isReplay: true, state: "PAUSED" }),
      row("replay-done", 3, { isReplay: true, state: "ENDED" }),
    ];
    expect(decideResume("published", sessions, true)).toEqual({ action: "create", isReplay: true });
  });

  it("rule 3: rewarded and no replay yet → create isReplay=true", () => {
    expect(decideResume("published", [row("won", 1, { state: "ENDED", rewarded: true })], true)).toEqual({
      action: "create",
      isReplay: true,
    });
  });

  it("rule 5: archived video → started sessions continue, new sessions are not found", () => {
    expect(decideResume("archived", [row("s", 1)], false)).toEqual({ action: "resume", sessionId: "s" });
    expect(decideResume("archived", [], false)).toEqual({ action: "not_found" });
    expect(decideResume("archived", [row("won", 1, { state: "ENDED", rewarded: true })], true)).toEqual({ action: "not_found" });
  });

  it("draft video → not found", () => {
    expect(decideResume("draft", [row("s", 1)], false)).toEqual({ action: "not_found" });
  });
});

describe("§4.3 rule 4 applyResume", () => {
  it("PLAYING → PAUSED, lastPlayingAt = null, RESUME row with seq NULL", () => {
    const r = applyResume(playing({ positionSec: 17 }));
    expect(r.session).toMatchObject({ state: "PAUSED", lastPlayingAt: null, positionSec: 17 });
    expect(r.event).toEqual({
      seq: null,
      type: "RESUME",
      positionSec: 17,
      accepted: true,
      rejectReason: null,
      fromState: "PLAYING",
      toState: "PAUSED",
    });
  });

  it.each<SessionState>(["CREATED", "PAUSED", "QUIZ_PENDING", "ENDED"])("%s is resumed unchanged, no write", (state) => {
    const s = session({ state });
    expect(applyResume(s)).toEqual({ session: s, event: null });
  });
});
