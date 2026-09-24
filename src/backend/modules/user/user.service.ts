import type { UserRewardSummary, RewardRepository } from "../reward/reward.interface";

export interface UserService {
  getMe(userId: string): Promise<UserRewardSummary>;
}

export function createUserService(deps: { rewardRepo: RewardRepository }): UserService {
  return {
    getMe: (userId) => deps.rewardRepo.getUserSummary(userId),
  };
}
