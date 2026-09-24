import { afterAll, describe, expect, it } from "vitest";
import { POST as postSessions } from "@/app/api/sessions/route";
import { prisma } from "@/backend/lib/prisma";
import { authedRequest, createTestQuestion, createTestVideo, newUserId, postJson } from "./helpers";

describe("POST /api/sessions", () => {
  afterAll(() => prisma.$disconnect());

  it("creates a fresh session with the documented shape and the video's quizzes", async () => {
    const video = await createTestVideo();
    await createTestQuestion(video.id, 13);
    const userId = newUserId();

    const res = await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      state: "CREATED",
      positionSec: 0,
      furthestSec: 0,
      lastSeq: 0,
      isReplay: false,
      alreadyRewarded: false,
      currentQuestionId: null,
      passedQuestionIds: [],
      video: { id: video.id, youtubeId: video.youtubeId, title: video.title, durationSec: 44, rewardPoints: 50 },
    });
    expect(body.quizzes).toHaveLength(1);
    expect(body.quizzes[0]).toMatchObject({ triggerSec: 13, prompt: "Test question?" });
    expect(body.quizzes[0].choices).toEqual([
      { label: "A", text: "a" },
      { label: "B", text: "b" },
      { label: "C", text: "c" },
      { label: "D", text: "d" },
    ]);
    expect(body.quizzes[0]).not.toHaveProperty("correctChoice");
  });

  it("resumes the same session on a second call for the same user + video", async () => {
    const video = await createTestVideo();
    const userId = newUserId();

    const first = await (await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }))).json();
    const second = await (await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }))).json();

    expect(second.sessionId).toBe(first.sessionId);
  });

  it("a different user gets their own session for the same video", async () => {
    const video = await createTestVideo();
    const a = await (await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId: newUserId() }))).json();
    const b = await (await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId: newUserId() }))).json();
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("resuming a PLAYING session pauses it (resume rule 4)", async () => {
    const video = await createTestVideo();
    const userId = newUserId();
    const created = await (await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }))).json();
    await prisma.watchSession.update({ where: { id: created.sessionId }, data: { state: "PLAYING", lastPlayingAt: new Date() } });

    const resumed = await (await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }))).json();
    expect(resumed.sessionId).toBe(created.sessionId);
    expect(resumed.state).toBe("PAUSED");

    const row = await prisma.watchSession.findUniqueOrThrow({ where: { id: created.sessionId } });
    expect(row.lastPlayingAt).toBeNull();
    const resumeEvent = await prisma.watchEvent.findFirst({ where: { sessionId: created.sessionId, type: "RESUME" } });
    expect(resumeEvent).toMatchObject({ seq: null, accepted: true, fromState: "PLAYING", toState: "PAUSED" });
  });

  it("404 VIDEO_NOT_FOUND for a nonexistent videoId", async () => {
    const res = await postSessions(postJson("http://t/api/sessions", { videoId: "does-not-exist" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("VIDEO_NOT_FOUND");
  });

  it("404 VIDEO_NOT_FOUND for a draft video (not yet published)", async () => {
    const video = await createTestVideo({ status: "draft" });
    const res = await postSessions(postJson("http://t/api/sessions", { videoId: video.id }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("VIDEO_NOT_FOUND");
  });

  it("400 VALIDATION_ERROR when videoId is missing", async () => {
    const res = await postSessions(postJson("http://t/api/sessions", {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR for a malformed JSON body", async () => {
    const res = await postSessions(authedRequest("http://t/api/sessions", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
