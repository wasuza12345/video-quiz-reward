import type { NextRequest } from "next/server";
import { requireUserId } from "@/backend/common/auth/user-cookie";
import { ok } from "@/backend/common/http/response";
import type { RewardService } from "./reward.service";

export function createRewardController(deps: { rewardService: RewardService }) {
  return {
    async claim(request: NextRequest, sessionId: string) {
      const userId = requireUserId(request);
      return ok(await deps.rewardService.claim(sessionId, userId));
    },
  };
}
