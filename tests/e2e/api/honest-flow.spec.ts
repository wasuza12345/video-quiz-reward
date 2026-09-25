// The honest flow (plan §5, §6): PLAY → TICKs to the quiz gate → wrong answer (retry)
// → correct answer → PLAY → TICKs to the end → ENDED → claim +50 exactly once, even under a
// concurrent double-claim → GET /api/me reflects it → a fresh POST /api/sessions afterwards
// starts a replay but still reports alreadyRewarded. Also role scenario #1 (correct/incorrect
// answers, submit once, validation) folded in since it's free along this same session.
//
// Real wall-clock: ~48s of TICKs (44 × ~1.1s honest pacing) — this is expected, not slow test
// code (plan §6: "a script that sends events at 1× real time is indistinguishable from a
// viewer — it still has to wait the full video").
import { expect, test } from "@playwright/test";
import {
  claim,
  createSession,
  findVideoByYoutubeId,
  getMe,
  playHonestlyTo,
  postAnswer,
  postEvents,
  UserSession,
  type ClaimBody,
  type EventsApplyBody,
  type SessionCreateBody,
} from "../helpers/api";
import { BRIEF_QUESTION_CORRECT_CHOICE, BRIEF_QUESTION_TRIGGER_SEC, BRIEF_VIDEO_DURATION_SEC, BRIEF_VIDEO_YOUTUBE_ID } from "../helpers/env";

test.setTimeout(150_000);

test("honest flow: quiz retry then correct, full watch, exactly-once reward, replay keeps alreadyRewarded", async ({ request }) => {
  const user = new UserSession(request);
  const video = await findVideoByYoutubeId(user, BRIEF_VIDEO_YOUTUBE_ID);
  expect(video.durationSec).toBe(BRIEF_VIDEO_DURATION_SEC);
  expect(video.questionCount).toBe(1);

  // --- create ---
  const createRes = await createSession(user, video.id);
  expect(createRes.status(), await createRes.text()).toBe(200);
  const created = (await createRes.json()) as SessionCreateBody;
  expect(created.state).toBe("CREATED");
  expect(created.positionSec).toBe(0);
  expect(created.isReplay).toBe(false);
  expect(created.alreadyRewarded).toBe(false);
  expect(created.quizzes).toHaveLength(1);
  const { sessionId } = created;
  const questionId = created.quizzes[0].id;
  expect(created.quizzes[0].triggerSec).toBe(BRIEF_QUESTION_TRIGGER_SEC);

  // --- validation, before any play: missing field, and answering when not at a quiz ---
  const missingChoice = await user.post(`/api/sessions/${sessionId}/answer`, { data: { questionId } });
  expect(missingChoice.status()).toBe(400);
  expect((await missingChoice.json()).error.code).toBe("VALIDATION_ERROR");

  const answerTooEarly = await postAnswer(user, sessionId, questionId, "A");
  expect(answerTooEarly.status()).toBe(409);
  expect((await answerTooEarly.json()).error.code).toBe("NOT_AT_QUIZ");

  // --- PLAY, then honest TICKs up to the quiz gate ---
  const playRes = await postEvents(user, sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
  expect(playRes.status(), await playRes.text()).toBe(200);
  expect(((await playRes.json()) as EventsApplyBody).state).toBe("PLAYING");

  const toGate = await playHonestlyTo(user, sessionId, { fromSeq: 2, fromPositionSec: 0, toPositionSec: BRIEF_QUESTION_TRIGGER_SEC });
  expect(toGate.lastBody.state).toBe("QUIZ_PENDING");
  expect(toGate.lastBody.currentQuestionId).toBe(questionId);
  expect(toGate.lastBody.positionSec).toBe(BRIEF_QUESTION_TRIGGER_SEC);

  // --- wrong answer: retry allowed ---
  const wrong = await postAnswer(user, sessionId, questionId, "A");
  expect(wrong.status(), await wrong.text()).toBe(200);
  expect(await wrong.json()).toMatchObject({ correct: false, state: "QUIZ_PENDING" });

  // --- invalid choice label: 400, not a "wrong answer" ---
  const invalid = await postAnswer(user, sessionId, questionId, "Z");
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error.code).toBe("INVALID_CHOICE");

  // --- correct answer ---
  const correct = await postAnswer(user, sessionId, questionId, BRIEF_QUESTION_CORRECT_CHOICE);
  expect(correct.status(), await correct.text()).toBe(200);
  expect(await correct.json()).toMatchObject({ correct: true, state: "PAUSED" });

  // --- submit once: answering again (even correctly) is no longer "at this quiz" ---
  const again = await postAnswer(user, sessionId, questionId, BRIEF_QUESTION_CORRECT_CHOICE);
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("NOT_AT_QUIZ");

  // --- PLAY again, honest TICKs to the end ---
  const play2 = await postEvents(user, sessionId, [{ seq: toGate.nextSeq, type: "PLAY", positionSec: BRIEF_QUESTION_TRIGGER_SEC }]);
  expect(play2.status(), await play2.text()).toBe(200);
  expect(((await play2.json()) as EventsApplyBody).state).toBe("PLAYING");

  const toEnd = await playHonestlyTo(user, sessionId, {
    fromSeq: toGate.nextSeq + 1,
    fromPositionSec: BRIEF_QUESTION_TRIGGER_SEC,
    toPositionSec: BRIEF_VIDEO_DURATION_SEC,
  });
  expect(toEnd.lastBody.state).toBe("PLAYING");
  expect(toEnd.lastBody.furthestSec).toBe(BRIEF_VIDEO_DURATION_SEC);

  // --- ENDED ---
  const endedRes = await postEvents(user, sessionId, [{ seq: toEnd.nextSeq, type: "ENDED", positionSec: BRIEF_VIDEO_DURATION_SEC }]);
  expect(endedRes.status(), await endedRes.text()).toBe(200);
  const ended = (await endedRes.json()) as EventsApplyBody;
  expect(ended.state).toBe("ENDED");
  expect(ended.results[0]).toMatchObject({ accepted: true, rejectReason: null });

  // --- exactly-once reward, even under a concurrent double-claim ---
  const [claimA, claimB] = await Promise.all([claim(user, sessionId), claim(user, sessionId)]);
  expect(claimA.status(), await claimA.text()).toBe(200);
  expect(claimB.status(), await claimB.text()).toBe(200);
  const bodyA = (await claimA.json()) as ClaimBody;
  const bodyB = (await claimB.json()) as ClaimBody;
  const awardedCount = [bodyA, bodyB].filter((b) => b.awarded).length;
  expect(awardedCount, "exactly one of the two concurrent claims must be awarded").toBe(1);
  const winner = bodyA.awarded ? bodyA : bodyB;
  const loser = bodyA.awarded ? bodyB : bodyA;
  expect(winner.points).toBe(video.rewardPoints);
  expect(loser.points).toBe(0);
  expect(bodyA.totalPoints).toBe(video.rewardPoints);
  expect(bodyB.totalPoints).toBe(video.rewardPoints);

  const meRes = await getMe(user);
  expect(meRes.status()).toBe(200);
  const me = await meRes.json();
  expect(me.totalPoints).toBe(video.rewardPoints);
  expect(me.rewardedVideoIds).toContain(video.id);

  // --- a further, sequential claim is still a no-op (not a double award) ---
  const thirdClaim = await claim(user, sessionId);
  expect(thirdClaim.status(), await thirdClaim.text()).toBe(200);
  const third = (await thirdClaim.json()) as ClaimBody;
  expect(third).toMatchObject({ awarded: false, points: 0, totalPoints: video.rewardPoints });

  // --- refresh after finishing: alreadyRewarded and the point total both survive a fresh
  // POST /api/sessions (resume-policy rule 3: the rewarded session itself is never resumed, so
  // this is a brand new replay session — role scenario "reload after finishing keeps the
  // unlocked/rewarded state" is the alreadyRewarded flag + totalPoints, not session identity) ---
  const refreshRes = await createSession(user, video.id);
  expect(refreshRes.status(), await refreshRes.text()).toBe(200);
  const refreshed = (await refreshRes.json()) as SessionCreateBody;
  expect(refreshed.alreadyRewarded).toBe(true);
  expect(refreshed.isReplay).toBe(true);
  expect(refreshed.sessionId).not.toBe(sessionId);

  const meAfterRefresh = await getMe(user);
  expect((await meAfterRefresh.json()).totalPoints).toBe(video.rewardPoints);
});
