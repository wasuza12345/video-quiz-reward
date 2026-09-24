import { decideClaim } from "@/backend/domain/reward-policy";
import { AppError } from "@/backend/common/errors/app-error";
import type { VideoRepository } from "../video/video.interface";
import type { WatchSessionRepository } from "../watch-session/watch-session.interface";
import type { RewardRepository } from "./reward.interface";

export interface ClaimResult {
  awarded: boolean;
  points: number;
  totalPoints: number;
}

export interface RewardService {
  claim(sessionId: string, userId: string): Promise<ClaimResult>;
}

export function createRewardService(deps: {
  rewardRepo: RewardRepository;
  sessionRepo: WatchSessionRepository;
  videoRepo: VideoRepository;
}): RewardService {
  return {
    async claim(sessionId, userId) {
      const row = await deps.sessionRepo.findById(sessionId);
      if (!row || row.userId !== userId) throw new AppError("NOT_OWNER", "not your session");

      const video = await deps.videoRepo.findById(row.videoId);
      if (!video) throw new AppError("VIDEO_NOT_FOUND", "video not found");

      const alreadyRewarded = (await deps.rewardRepo.findRewardedVideoIds(userId, [row.videoId])).has(row.videoId);
      const decision = decideClaim({ state: row.state, isReplay: row.isReplay }, alreadyRewarded, video.rewardPoints);
      if (!decision.ok) throw new AppError("NOT_ENDED", "session has not ended");

      // The ledger row is created outside any interactive transaction; its unique keys are the
      // only thing that needs to serialize concurrent claims across different sessions for the
      // same video — a P2002 there resolves to `awarded: false`, never a throw (plan §3, §4.2).
      const outcome = decision.award
        ? await deps.rewardRepo.createLedgerRow({ userId, videoId: row.videoId, sessionId, points: decision.points })
        : { awarded: false, points: 0 };

      // Best-effort CLAIM audit row via the same CAS write as every other session mutation
      // (plan §4.2); losing this rare race never loses the ledger outcome computed above.
      await deps.sessionRepo.casUpdate(sessionId, row.version, row, { lastSeq: row.lastSeq, eventCountDelta: 0 }, [
        {
          seq: null,
          type: "CLAIM",
          positionSec: row.positionSec,
          accepted: true,
          rejectReason: null,
          fromState: row.state,
          toState: row.state,
          payload: { awarded: outcome.awarded, points: outcome.points },
          clientAt: null,
        },
      ]);

      const { totalPoints } = await deps.rewardRepo.getUserSummary(userId);
      return { awarded: outcome.awarded, points: outcome.points, totalPoints };
    },
  };
}
