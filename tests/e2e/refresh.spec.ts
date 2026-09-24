// P6-early — refresh (role scenario #5): reloading mid-video resumes the SAME session, paused,
// at the last server-confirmed position, with points untouched. (Refresh after finishing —
// alreadyRewarded / totalPoints surviving a brand new session — is covered at the tail of
// honest-flow.spec.ts, since it needs an already-rewarded session to refresh from.)
import { expect, test } from "@playwright/test";
import { createSession, findVideoByYoutubeId, getMe, postEvents, UserSession, type EventsApplyBody, type SessionCreateBody } from "./helpers/api";
import { CHEATS_VIDEO_YOUTUBE_ID } from "./helpers/env";

test("refresh mid-video: POST /api/sessions again resumes the same session, paused, at the same position", async ({ request }) => {
  const user = new UserSession(request);
  const video = await findVideoByYoutubeId(user, CHEATS_VIDEO_YOUTUBE_ID);

  const created = await createSession(user, video.id);
  expect(created.status(), await created.text()).toBe(200);
  const first = (await created.json()) as SessionCreateBody;

  const play = await postEvents(user, first.sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
  expect(play.status(), await play.text()).toBe(200);
  expect(((await play.json()) as EventsApplyBody).state).toBe("PLAYING");

  const tick = await postEvents(user, first.sessionId, [{ seq: 2, type: "TICK", positionSec: 1 }]);
  expect(tick.status(), await tick.text()).toBe(200);
  const ticked = (await tick.json()) as EventsApplyBody;
  expect(ticked.state).toBe("PLAYING");
  expect(ticked.positionSec).toBe(1);

  const meBefore = await getMe(user);
  expect((await meBefore.json()).totalPoints).toBe(0);

  // "Refresh": the client re-issues POST /api/sessions for the same video on page load.
  const resumed = await createSession(user, video.id);
  expect(resumed.status(), await resumed.text()).toBe(200);
  const resumedBody = (await resumed.json()) as SessionCreateBody;

  expect(resumedBody.sessionId, "refresh must resume the SAME session, not create a new one").toBe(first.sessionId);
  expect(resumedBody.state, "resume-policy rule 4: a PLAYING session becomes PAUSED on resume").toBe("PAUSED");
  expect(resumedBody.positionSec).toBe(1);
  expect(resumedBody.furthestSec).toBe(1);
  expect(resumedBody.lastSeq, "the server-side RESUME audit event has seq=null and must not bump lastSeq").toBe(2);
  expect(resumedBody.isReplay).toBe(false);
  expect(resumedBody.alreadyRewarded).toBe(false);

  const meAfter = await getMe(user);
  expect((await meAfter.json()).totalPoints, "points are kept (still 0 — this session hasn't ended) across the refresh").toBe(0);

  // Playback can continue normally after the resume.
  const resumePlay = await postEvents(user, first.sessionId, [{ seq: 3, type: "PLAY", positionSec: 1 }]);
  expect(resumePlay.status(), await resumePlay.text()).toBe(200);
  expect(((await resumePlay.json()) as EventsApplyBody).state).toBe("PLAYING");

  const resumeTick = await postEvents(user, first.sessionId, [{ seq: 4, type: "TICK", positionSec: 2 }]);
  expect(resumeTick.status(), await resumeTick.text()).toBe(200);
  const resumeTicked = (await resumeTick.json()) as EventsApplyBody;
  expect(resumeTicked.results[0]).toMatchObject({ accepted: true, rejectReason: null });
  expect(resumeTicked.furthestSec).toBe(2);
});
