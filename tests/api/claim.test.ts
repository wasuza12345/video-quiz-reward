import { afterAll, describe, expect, it } from "vitest";
import { POST as postSessions } from "@/app/api/sessions/route";
import { POST as postClaim } from "@/app/api/sessions/[id]/claim/route";
import { prisma } from "@/backend/lib/prisma";
import { createTestVideo, newUserId, paramsOf, postJson } from "./helpers";

/** A session already at ENDED (arranged directly — canEnd()/the ENDED transition itself is
 * covered by the domain and scenario tests; claim doesn't re-check it, only `state === ENDED`). */
async function createEndedSession(userId: string, videoId: string) {
  const res = await postSessions(postJson("http://t/api/sessions", { videoId }, { userId }));
  const { sessionId } = (await res.json()) as { sessionId: string };
  await prisma.watchSession.update({ where: { id: sessionId }, data: { state: "ENDED", endedAt: new Date(), furthestSec: 44, playedWallSec: 40 } });
  return sessionId;
}

describe("POST /api/sessions/:id/claim", () => {
  afterAll(() => prisma.$disconnect());

  it("awards the video's points once, and reports the user's new total", async () => {
    const video = await createTestVideo({ rewardPoints: 50 });
    const userId = newUserId();
    const sessionId = await createEndedSession(userId, video.id);

    const res = await postClaim(postJson(`http://t/api/sessions/${sessionId}/claim`, {}, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ awarded: true, points: 50, totalPoints: 50 });

    const ledger = await prisma.pointsLedger.findUnique({ where: { sessionId } });
    expect(ledger).toMatchObject({ userId, videoId: video.id, points: 50, reason: "video_completed" });
    const auditRow = await prisma.watchEvent.findFirst({ where: { sessionId, type: "CLAIM" } });
    expect(auditRow).toMatchObject({ seq: null, accepted: true, fromState: "ENDED", toState: "ENDED" });
  });

  it("a second claim on the same session is not awarded again", async () => {
    const video = await createTestVideo({ rewardPoints: 50 });
    const userId = newUserId();
    const sessionId = await createEndedSession(userId, video.id);

    await postClaim(postJson(`http://t/api/sessions/${sessionId}/claim`, {}, { userId }), paramsOf(sessionId));
    const res = await postClaim(postJson(`http://t/api/sessions/${sessionId}/claim`, {}, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ awarded: false, points: 0, totalPoints: 50 });
  });

  it("a replay session (video already rewarded) claims 0 points", async () => {
    const video = await createTestVideo({ rewardPoints: 50 });
    const userId = newUserId();
    const first = await createEndedSession(userId, video.id);
    await postClaim(postJson(`http://t/api/sessions/${first}/claim`, {}, { userId }), paramsOf(first));

    const replay = await prisma.watchSession.create({
      data: { userId, videoId: video.id, isReplay: true, state: "ENDED", endedAt: new Date(), furthestSec: 44, playedWallSec: 40 },
    });
    const res = await postClaim(postJson(`http://t/api/sessions/${replay.id}/claim`, {}, { userId }), paramsOf(replay.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ awarded: false, points: 0, totalPoints: 50 });
  });

  it("422 NOT_ENDED when the session hasn't ended", async () => {
    const video = await createTestVideo();
    const userId = newUserId();
    const res0 = await postSessions(postJson("http://t/api/sessions", { videoId: video.id }, { userId }));
    const { sessionId } = (await res0.json()) as { sessionId: string };

    const res = await postClaim(postJson(`http://t/api/sessions/${sessionId}/claim`, {}, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("NOT_ENDED");
  });

  it("403 NOT_OWNER when the session belongs to another user", async () => {
    const video = await createTestVideo();
    const owner = newUserId();
    const sessionId = await createEndedSession(owner, video.id);

    const res = await postClaim(postJson(`http://t/api/sessions/${sessionId}/claim`, {}, { userId: newUserId() }), paramsOf(sessionId));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_OWNER");
  });

  it("concurrent claim from two sessions of the same user+video: awarded exactly once", async () => {
    const video = await createTestVideo({ rewardPoints: 50 });
    const userId = newUserId();
    // Two sessions for the same (user, video) — the accepted race of plan §4.3 rule 6 (two tabs
    // creating a session at the same moment). Both independently reach ENDED.
    const sessionA = await createEndedSession(userId, video.id);
    const sessionB = await prisma.watchSession.create({
      data: { userId, videoId: video.id, state: "ENDED", endedAt: new Date(), furthestSec: 44, playedWallSec: 40 },
    });

    const [resA, resB] = await Promise.all([
      postClaim(postJson(`http://t/api/sessions/${sessionA}/claim`, {}, { userId }), paramsOf(sessionA)),
      postClaim(postJson(`http://t/api/sessions/${sessionB.id}/claim`, {}, { userId }), paramsOf(sessionB.id)),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    const awardedCount = [bodyA, bodyB].filter((b) => b.awarded).length;
    expect(awardedCount).toBe(1);
    const winner = bodyA.awarded ? bodyA : bodyB;
    expect(winner.points).toBe(50);
    expect(bodyA.totalPoints).toBe(50);
    expect(bodyB.totalPoints).toBe(50);

    const ledgerRows = await prisma.pointsLedger.findMany({ where: { userId, videoId: video.id } });
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].points).toBe(50);
  });
});
