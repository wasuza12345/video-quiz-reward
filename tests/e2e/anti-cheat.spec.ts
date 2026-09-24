// P6-early — anti-cheat (plan §6, role scenario #3): forward seeks, forged/faked progress, and
// calling ENDED/claim directly without the required watch time are all rejected server-side.
// Each test gets its own fresh `request` context (own cookie => own user => own fresh session),
// so they can safely share the same throwaway fixture video without interfering with each other.
import { expect, test } from "@playwright/test";
import { claim, createSession, findVideoByYoutubeId, postEvents, UserSession, type EventsApplyBody } from "./helpers/api";
import { readSessionFlags } from "./helpers/db";
import { CHEATS_VIDEO_YOUTUBE_ID } from "./helpers/env";

async function freshCheatSession(user: UserSession) {
  const video = await findVideoByYoutubeId(user, CHEATS_VIDEO_YOUTUBE_ID);
  const created = await createSession(user, video.id);
  expect(created.status(), await created.text()).toBe(200);
  const { sessionId } = await created.json();
  const play = await postEvents(user, sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
  expect(play.status(), await play.text()).toBe(200);
  return { video, sessionId };
}

test("a forward SEEK past the bank is rejected (SEEK_FORWARD) and flags the session", async ({ request }) => {
  const user = new UserSession(request);
  const { sessionId } = await freshCheatSession(user);

  const res = await postEvents(user, sessionId, [{ seq: 2, type: "SEEK", positionSec: 20 }]);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as EventsApplyBody;
  expect(body.results[0]).toMatchObject({ accepted: false, rejectReason: "SEEK_FORWARD" });
  expect(body.positionSec, "a rejected SEEK must not move the position").toBe(0);

  const flags = await readSessionFlags(sessionId);
  expect(flags.flagged, "SEEK_FORWARD flags the session immediately (plan §5)").toBe(true);
});

test("forged TICKs: over the bank is soft SPEED_EXCEEDED, far over is hard SEEK_FORWARD", async ({ request }) => {
  const user = new UserSession(request);
  const { sessionId } = await freshCheatSession(user);

  // No time passed since PLAY, so the bank is still ~3s: pos=8 needs 8s, which is more than the
  // bank can pay but not more than it could ever hold (≤ 10) — a soft, unflagged reject.
  const over = await postEvents(user, sessionId, [{ seq: 2, type: "TICK", positionSec: 8 }]);
  expect(over.status(), await over.text()).toBe(200);
  const overBody = (await over.json()) as EventsApplyBody;
  expect(overBody.results[0]).toMatchObject({ accepted: false, rejectReason: "SPEED_EXCEEDED" });
  expect(overBody.furthestSec, "a rejected TICK must not raise furthestSec").toBe(0);

  const afterFirst = await readSessionFlags(sessionId);
  expect(afterFirst.flagged).toBe(false);
  expect(afterFirst.softRejectCount).toBe(1);

  // furthestSec is still 0 (the previous TICK was rejected), so pos=16 needs 16s — more than the
  // bank could ever hold (> 10s) — a hard forward-seek reject, flagged immediately.
  const way = await postEvents(user, sessionId, [{ seq: 3, type: "TICK", positionSec: 16 }]);
  expect(way.status(), await way.text()).toBe(200);
  const wayBody = (await way.json()) as EventsApplyBody;
  expect(wayBody.results[0]).toMatchObject({ accepted: false, rejectReason: "SEEK_FORWARD" });

  const afterSecond = await readSessionFlags(sessionId);
  expect(afterSecond.flagged).toBe(true);
});

test("ENDED before 0.9×duration of real play time is rejected (NOT_WATCHED)", async ({ request }) => {
  const user = new UserSession(request);
  const { sessionId } = await freshCheatSession(user);

  const res = await postEvents(user, sessionId, [{ seq: 2, type: "ENDED", positionSec: 0 }]);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as EventsApplyBody;
  expect(body.results[0]).toMatchObject({ accepted: false, rejectReason: "NOT_WATCHED" });
  expect(body.state, "a rejected ENDED must not move the session to ENDED").not.toBe("ENDED");

  const flags = await readSessionFlags(sessionId);
  expect(flags.softRejectCount).toBeGreaterThanOrEqual(1);
});

test("claiming without an ENDED session is rejected (422 NOT_ENDED)", async ({ request }) => {
  const user = new UserSession(request);
  const video = await findVideoByYoutubeId(user, CHEATS_VIDEO_YOUTUBE_ID);
  const created = await createSession(user, video.id);
  expect(created.status(), await created.text()).toBe(200);
  const { sessionId } = await created.json();

  const res = await claim(user, sessionId);
  expect(res.status(), await res.text()).toBe(422);
  expect((await res.json()).error.code).toBe("NOT_ENDED");
});
