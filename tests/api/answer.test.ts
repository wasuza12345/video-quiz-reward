import { afterAll, describe, expect, it } from "vitest";
import { POST as postSessions } from "@/app/api/sessions/route";
import { POST as postAnswer } from "@/app/api/sessions/[id]/answer/route";
import { prisma } from "@/backend/lib/prisma";
import { createTestQuestion, createTestVideo, newUserId, paramsOf, postJson } from "./helpers";

/** A session already parked at QUIZ_PENDING for `question` (arranged directly — the state
 * machine's own TICK→QUIZ_PENDING transition is already covered by the domain and events tests). */
async function createQuizPendingSession(userId: string, videoId: string, questionId: string) {
  const res = await postSessions(postJson("http://t/api/sessions", { videoId }, { userId }));
  const { sessionId } = (await res.json()) as { sessionId: string };
  await prisma.watchSession.update({
    where: { id: sessionId },
    data: { state: "QUIZ_PENDING", currentQuestionId: questionId, positionSec: 13, furthestSec: 13, lastPlayingAt: null },
  });
  return sessionId;
}

describe("POST /api/sessions/:id/answer", () => {
  afterAll(() => prisma.$disconnect());

  it("correct choice → correct:true, session moves to PAUSED, question recorded as passed", async () => {
    const video = await createTestVideo();
    const question = await createTestQuestion(video.id, 13);
    const userId = newUserId();
    const sessionId = await createQuizPendingSession(userId, video.id, question.id);

    const res = await postAnswer(postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: question.id, choice: "D" }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ correct: true, state: "PAUSED" });

    const row = await prisma.watchSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(JSON.parse(row.passedQuestionIds)).toEqual([question.id]);
    expect(row.currentQuestionId).toBeNull();
    expect(row.eventCount).toBe(1); // answer counts toward the session's event cap (plan §10)

    const auditRow = await prisma.watchEvent.findFirst({ where: { sessionId, type: "ANSWER" } });
    expect(auditRow).toMatchObject({ seq: null, accepted: true, fromState: "QUIZ_PENDING", toState: "PAUSED" });
    expect(JSON.parse(auditRow!.payload!)).toEqual({ questionId: question.id, choice: "D", correct: true });
  });

  it("429 EVENT_LIMIT when the session is already at its event cap", async () => {
    const video = await createTestVideo();
    const question = await createTestQuestion(video.id, 13);
    const userId = newUserId();
    const sessionId = await createQuizPendingSession(userId, video.id, question.id);
    await prisma.watchSession.update({ where: { id: sessionId }, data: { eventCount: 2000 } });

    const res = await postAnswer(postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: question.id, choice: "D" }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("EVENT_LIMIT");
  });

  it("wrong choice → correct:false, session stays QUIZ_PENDING", async () => {
    const video = await createTestVideo();
    const question = await createTestQuestion(video.id, 13);
    const userId = newUserId();
    const sessionId = await createQuizPendingSession(userId, video.id, question.id);

    const res = await postAnswer(postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: question.id, choice: "A" }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ correct: false, state: "QUIZ_PENDING" });

    const row = await prisma.watchSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.currentQuestionId).toBe(question.id);
  });

  it("400 INVALID_CHOICE for a label the question doesn't have", async () => {
    const video = await createTestVideo();
    const question = await createTestQuestion(video.id, 13);
    const userId = newUserId();
    const sessionId = await createQuizPendingSession(userId, video.id, question.id);

    const res = await postAnswer(postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: question.id, choice: "Z" }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_CHOICE");
  });

  it("409 NOT_AT_QUIZ when the session isn't waiting on a quiz", async () => {
    const video = await createTestVideo();
    const question = await createTestQuestion(video.id, 13);
    const userId = newUserId();
    const res = await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }));
    const { sessionId } = (await res.json()) as { sessionId: string }; // state CREATED, not QUIZ_PENDING

    const answerRes = await postAnswer(
      postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: question.id, choice: "D" }, { userId }),
      paramsOf(sessionId),
    );
    expect(answerRes.status).toBe(409);
    expect((await answerRes.json()).error.code).toBe("NOT_AT_QUIZ");
  });

  it("409 NOT_AT_QUIZ when questionId doesn't match the session's current question", async () => {
    const video = await createTestVideo();
    const q1 = await createTestQuestion(video.id, 13);
    const q2 = await createTestQuestion(video.id, 30);
    const userId = newUserId();
    const sessionId = await createQuizPendingSession(userId, video.id, q1.id); // pending on q1

    const res = await postAnswer(postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: q2.id, choice: "D" }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_AT_QUIZ");
  });

  it("403 NOT_OWNER when the session belongs to another user", async () => {
    const video = await createTestVideo();
    const question = await createTestQuestion(video.id, 13);
    const owner = newUserId();
    const sessionId = await createQuizPendingSession(owner, video.id, question.id);

    const res = await postAnswer(
      postJson(`http://t/api/sessions/${sessionId}/answer`, { questionId: question.id, choice: "D" }, { userId: newUserId() }),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_OWNER");
  });
});
