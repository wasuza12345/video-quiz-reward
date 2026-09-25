// Repo-level (not through the API): pins the P2002 → awarded:false branch of createLedgerRow
// directly, since it's the actual concurrency guard for claim (plan §3, §4.2).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createRewardRepository } from "@/backend/modules/reward/reward.repository";
import { prisma } from "@/backend/lib/prisma";
import { createTestVideo } from "./helpers";

describe("RewardRepository.createLedgerRow", () => {
  afterAll(() => prisma.$disconnect());

  it("two calls for the same (user, video) on different sessions resolve [true, false]", async () => {
    const repo = createRewardRepository();
    const video = await createTestVideo({ rewardPoints: 50 });
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId } });
    const sessionA = await prisma.watchSession.create({ data: { userId, videoId: video.id, state: "ENDED" } });
    const sessionB = await prisma.watchSession.create({ data: { userId, videoId: video.id, state: "ENDED" } });

    const first = await repo.createLedgerRow({ userId, videoId: video.id, sessionId: sessionA.id, points: 50 });
    const second = await repo.createLedgerRow({ userId, videoId: video.id, sessionId: sessionB.id, points: 50 });

    expect([first.awarded, second.awarded]).toEqual([true, false]);
    expect(second.points).toBe(0);

    const rows = await prisma.pointsLedger.findMany({ where: { userId, videoId: video.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe(sessionA.id);
  });
});
