export interface UserRewardSummary {
  totalPoints: number;
  rewardedVideoIds: string[];
}

export interface ClaimOutcome {
  awarded: boolean;
  points: number;
}

export interface RewardRepository {
  /** Unknown/never-written userId returns `{ totalPoints: 0, rewardedVideoIds: [] }` (plan §4.1). */
  getUserSummary(userId: string): Promise<UserRewardSummary>;
  /** Which of `videoIds` this user already has a ledger row for — used for GET /api/videos `rewarded`. */
  findRewardedVideoIds(userId: string, videoIds: string[]): Promise<Set<string>>;
  /**
   * Creates the ledger row outside any interactive transaction (plan §3, §4.2). A P2002 unique
   * violation (on `sessionId`, or on `[userId, videoId, reason]` from a concurrent claim on a
   * different session for the same video) resolves to `{ awarded: false, points: 0 }`, not a throw.
   */
  createLedgerRow(input: { userId: string; videoId: string; sessionId: string; points: number }): Promise<ClaimOutcome>;
}
