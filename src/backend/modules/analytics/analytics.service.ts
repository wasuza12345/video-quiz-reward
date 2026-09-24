import { AppError } from "@/backend/common/errors/app-error";
import type { AdminSessionDetail, AdminStats, AdminUserDetail, AdminUserListItem, Paged, SessionRow } from "@/shared/contracts/admin";
import type { AnalyticsRepository, SessionListFilter, SessionRowData } from "./analytics.interface";

function toSessionRow(s: SessionRowData): SessionRow {
  return {
    id: s.id,
    userId: s.userId,
    videoId: s.videoId,
    videoTitle: s.videoTitle,
    state: s.state,
    flagged: s.flagged,
    isReplay: s.isReplay,
    furthestSec: s.furthestSec,
    durationSec: s.durationSec,
    playedWallSec: s.playedWallSec,
    pointsAwarded: s.pointsAwarded,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

export interface AnalyticsService {
  listUsers(page: number, pageSize: number): Promise<Paged<AdminUserListItem>>;
  userDetail(userId: string): Promise<AdminUserDetail>;
  listSessions(filter: SessionListFilter, page: number, pageSize: number): Promise<Paged<SessionRow>>;
  sessionDetail(sessionId: string): Promise<AdminSessionDetail>;
  stats(videoId?: string): Promise<AdminStats>;
}

export function createAnalyticsService(deps: { analyticsRepo: AnalyticsRepository }): AnalyticsService {
  return {
    async listUsers(page, pageSize) {
      const { items, total } = await deps.analyticsRepo.listUsers(page, pageSize);
      return {
        items: items.map((u) => ({
          id: u.id,
          createdAt: u.createdAt.toISOString(),
          totalPoints: u.totalPoints,
          sessionCount: u.sessionCount,
          lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
        })),
        page,
        pageSize,
        total,
      };
    },

    async userDetail(userId) {
      const data = await deps.analyticsRepo.findUserDetail(userId);
      if (!data) throw new AppError("USER_NOT_FOUND", "user not found");
      return {
        user: { id: data.id, createdAt: data.createdAt.toISOString(), totalPoints: data.totalPoints },
        ledger: data.ledger.map((l) => ({ sessionId: l.sessionId, videoId: l.videoId, videoTitle: l.videoTitle, points: l.points, createdAt: l.createdAt.toISOString() })),
        sessions: data.sessions.map(toSessionRow),
      };
    },

    async listSessions(filter, page, pageSize) {
      const { items, total } = await deps.analyticsRepo.listSessions(filter, page, pageSize);
      return { items: items.map(toSessionRow), page, pageSize, total };
    },

    async sessionDetail(sessionId) {
      const data = await deps.analyticsRepo.findSessionDetail(sessionId);
      if (!data) throw new AppError("SESSION_NOT_FOUND", "session not found");
      const { positionSec, bankSec, softRejectCount, passedQuestionIds, currentQuestionId, questionCount, lastSeq, version, eventCount } = data.session;
      return {
        session: { ...toSessionRow(data.session), positionSec, bankSec, softRejectCount, passedQuestionIds, currentQuestionId, questionCount, lastSeq, version, eventCount },
        events: data.events.map((e) => ({
          id: e.id,
          seq: e.seq,
          type: e.type,
          positionSec: e.positionSec,
          clientAt: e.clientAt ? e.clientAt.toISOString() : null,
          serverAt: e.serverAt.toISOString(),
          accepted: e.accepted,
          rejectReason: e.rejectReason,
          fromState: e.fromState,
          toState: e.toState,
          payload: e.payload,
        })),
      };
    },

    async stats(videoId) {
      return deps.analyticsRepo.stats(videoId);
    },
  };
}
