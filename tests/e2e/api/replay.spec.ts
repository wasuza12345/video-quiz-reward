// P6-early — role scenario #3/#4: a replay session (created after the video is already
// rewarded for this user) earns 0 points even when honestly rewatched start to finish. Uses a
// 6s fixture video (e2e-replay) so two full honest watches only cost ~13s of real wall time.
import { expect, test } from "@playwright/test";
import { claim, createSession, findVideoByYoutubeId, playHonestlyTo, postEvents, UserSession, type ClaimBody, type SessionCreateBody } from "../helpers/api";
import { REPLAY_VIDEO_DURATION_SEC, REPLAY_VIDEO_YOUTUBE_ID } from "../helpers/env";

test.setTimeout(60_000);

async function watchToEndAndClaim(user: UserSession, sessionId: string) {
  const play = await postEvents(user, sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
  expect(play.status(), await play.text()).toBe(200);

  const toEnd = await playHonestlyTo(user, sessionId, { fromSeq: 2, fromPositionSec: 0, toPositionSec: REPLAY_VIDEO_DURATION_SEC });
  expect(toEnd.lastBody.state).toBe("PLAYING");
  expect(toEnd.lastBody.furthestSec).toBe(REPLAY_VIDEO_DURATION_SEC);

  const ended = await postEvents(user, sessionId, [{ seq: toEnd.nextSeq, type: "ENDED", positionSec: REPLAY_VIDEO_DURATION_SEC }]);
  expect(ended.status(), await ended.text()).toBe(200);
  expect((await ended.json()).state).toBe("ENDED");

  const claimed = await claim(user, sessionId);
  expect(claimed.status(), await claimed.text()).toBe(200);
  return (await claimed.json()) as ClaimBody;
}

test("a replay session earns 0, even watched honestly to the end", async ({ request }) => {
  const user = new UserSession(request);
  const video = await findVideoByYoutubeId(user, REPLAY_VIDEO_YOUTUBE_ID);
  expect(video.durationSec).toBe(REPLAY_VIDEO_DURATION_SEC);

  const first = await createSession(user, video.id);
  expect(first.status(), await first.text()).toBe(200);
  const firstBody = (await first.json()) as SessionCreateBody;
  expect(firstBody.isReplay).toBe(false);

  const firstClaim = await watchToEndAndClaim(user, firstBody.sessionId);
  expect(firstClaim).toMatchObject({ awarded: true, points: video.rewardPoints, totalPoints: video.rewardPoints });

  const second = await createSession(user, video.id);
  expect(second.status(), await second.text()).toBe(200);
  const secondBody = (await second.json()) as SessionCreateBody;
  expect(secondBody.isReplay, "a new session for an already-rewarded video must be a replay").toBe(true);
  expect(secondBody.alreadyRewarded).toBe(true);
  expect(secondBody.sessionId).not.toBe(firstBody.sessionId);

  const secondClaim = await watchToEndAndClaim(user, secondBody.sessionId);
  expect(secondClaim).toMatchObject({ awarded: false, points: 0, totalPoints: video.rewardPoints });
});
