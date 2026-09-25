import { Prisma, prisma } from "@/backend/lib/prisma";
import type { MeResponse } from "@/shared/contracts/video";
import type { ClaimOutcome, RewardRepository } from "./reward.interface";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export function createRewardRepository(): RewardRepository {
  return {
    async getUserSummary(userId): Promise<MeResponse> {
      const ledger = await prisma.pointsLedger.findMany({ where: { userId }, select: { points: true, videoId: true } });
      return {
        totalPoints: ledger.reduce((sum, row) => sum + row.points, 0),
        rewardedVideoIds: ledger.map((row) => row.videoId),
      };
    },

    async findRewardedVideoIds(userId, videoIds) {
      if (videoIds.length === 0) return new Set();
      const rows = await prisma.pointsLedger.findMany({
        where: { userId, videoId: { in: videoIds } },
        select: { videoId: true },
      });
      return new Set(rows.map((r) => r.videoId));
    },

    async createLedgerRow({ userId, videoId, sessionId, points }): Promise<ClaimOutcome> {
      try {
        await prisma.pointsLedger.create({ data: { userId, videoId, sessionId, points, reason: "video_completed" } });
        return { awarded: true, points };
      } catch (err) {
        if (isUniqueViolation(err)) return { awarded: false, points: 0 };
        throw err;
      }
    },
  };
}
