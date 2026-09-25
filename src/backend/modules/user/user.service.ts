import type { MeResponse } from "@/shared/contracts/video";
import type { RewardRepository } from "../reward/reward.interface";

export interface UserService {
  getMe(userId: string): Promise<MeResponse>;
}

export function createUserService(deps: { rewardRepo: RewardRepository }): UserService {
  return {
    getMe: (userId) => deps.rewardRepo.getUserSummary(userId),
  };
}
