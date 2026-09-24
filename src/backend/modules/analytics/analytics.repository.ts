import { prisma } from "@/backend/lib/prisma";
import type {
  AdminSessionDetailData,
  AdminUserDetailData,
  AdminUserListRow,
  AnalyticsRepository,
  SessionListFilter,
  SessionRowData,
} from "./analytics.interface";

const SESSION_INCLUDE = { video: { select: { title: true, durationSec: true } }, reward: { select: { points: true } } } as const;

type SessionWithRelations = {
  id: string;
  userId: string;
  videoId: string;
  video: { title: string; durationSec: number };
  reward: { points: number } | null;
  state: string;
  flagged: boolean;
  isReplay: boolean;
  furthestSec: number;
  playedWallSec: number;
  startedAt: Date;
  endedAt: Date | null;
};

function toSessionRow(s: SessionWithRelations): SessionRowData {
  return {
    id: s.id,
    userId: s.userId,
    videoId: s.videoId,
    videoTitle: s.video.title,
    state: s.state,
    flagged: s.flagged,
    isReplay: s.isReplay,
    furthestSec: s.furthestSec,
    durationSec: s.video.durationSec,
    playedWallSec: s.playedWallSec,
    pointsAwarded: s.reward?.points ?? 0,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  };
}

/** Admin lists/details are always paged or capped (review round 2 MINOR 7) — a user's lifetime
 * ledger/session history is unbounded, and loading all of it just to sum/count/max it in JS
 * doesn't scale the way a DB-side aggregate does. */
const USER_DETAIL_ROW_CAP = 100;

export function createAnalyticsRepository(): AnalyticsRepository {
  return {
    async listUsers(page, pageSize) {
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { sessions: true } } },
        }),
        prisma.user.count(),
      ]);
      const userIds = users.map((u) => u.id);
      // Two grouped aggregates over just this page's users, instead of loading every session/
      // ledger row for them and reducing in JS (review round 2 MINOR 7).
      const [pointsSums, lastActive] = await Promise.all([
        prisma.pointsLedger.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _sum: { points: true } }),
        prisma.watchSession.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _max: { startedAt: true } }),
      ]);
      const pointsByUser = new Map(pointsSums.map((p) => [p.userId, p._sum.points ?? 0]));
      const lastActiveByUser = new Map(lastActive.map((s) => [s.userId, s._max.startedAt ?? null]));

      const items: AdminUserListRow[] = users.map((u) => ({
        id: u.id,
        createdAt: u.createdAt,
        totalPoints: pointsByUser.get(u.id) ?? 0,
        sessionCount: u._count.sessions,
        lastActiveAt: lastActiveByUser.get(u.id) ?? null,
      }));
      return { items, total };
    },

    async findUserDetail(userId): Promise<AdminUserDetailData | null> {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return null;

      const [totalPointsAgg, ledgerRows, sessionRows] = await Promise.all([
        prisma.pointsLedger.aggregate({ where: { userId }, _sum: { points: true } }),
        prisma.pointsLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: USER_DETAIL_ROW_CAP, include: { video: { select: { title: true } } } }),
        prisma.watchSession.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: USER_DETAIL_ROW_CAP, include: SESSION_INCLUDE }),
      ]);

      return {
        id: user.id,
        createdAt: user.createdAt,
        // From the aggregate, not `ledgerRows.reduce(...)` — ledgerRows is capped at 100, which
        // would undercount a heavier user's true lifetime total.
        totalPoints: totalPointsAgg._sum.points ?? 0,
        ledger: ledgerRows.map((l) => ({ sessionId: l.sessionId, videoId: l.videoId, videoTitle: l.video.title, points: l.points, createdAt: l.createdAt })),
        sessions: sessionRows.map(toSessionRow),
      };
    },

    async listSessions(filter: SessionListFilter, page, pageSize) {
      const where = { ...(filter.videoId ? { videoId: filter.videoId } : {}), ...(filter.flagged !== undefined ? { flagged: filter.flagged } : {}) };
      const [rows, total] = await Promise.all([
        prisma.watchSession.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: SESSION_INCLUDE }),
        prisma.watchSession.count({ where }),
      ]);
      return { items: rows.map(toSessionRow), total };
    },

    async findSessionDetail(sessionId): Promise<AdminSessionDetailData | null> {
      const s = await prisma.watchSession.findUnique({
        where: { id: sessionId },
        include: { ...SESSION_INCLUDE, video: { select: { title: true, durationSec: true, _count: { select: { questions: true } } } } },
      });
      if (!s) return null;
      const events = await prisma.watchEvent.findMany({ where: { sessionId }, orderBy: [{ serverAt: "asc" }, { id: "asc" }] });

      return {
        session: {
          ...toSessionRow(s),
          positionSec: s.positionSec,
          bankSec: s.bankSec,
          softRejectCount: s.softRejectCount,
          passedQuestionIds: JSON.parse(s.passedQuestionIds) as string[],
          currentQuestionId: s.currentQuestionId,
          questionCount: s.video._count.questions,
          lastSeq: s.lastSeq,
          version: s.version,
          eventCount: s.eventCount,
        },
        events: events.map((e) => ({
          id: e.id,
          seq: e.seq,
          type: e.type,
          positionSec: e.positionSec,
          clientAt: e.clientAt,
          serverAt: e.serverAt,
          accepted: e.accepted,
          rejectReason: e.rejectReason,
          fromState: e.fromState,
          toState: e.toState,
          payload: e.payload,
        })),
      };
    },

    async stats(videoId) {
      const videoWhere = videoId ? { videoId } : {};
      const [views, completions, pointsAgg, flaggedSessions] = await Promise.all([
        prisma.watchSession.count({ where: { ...videoWhere, isReplay: false } }),
        prisma.pointsLedger.count({ where: videoWhere }),
        prisma.pointsLedger.aggregate({ where: videoWhere, _sum: { points: true } }),
        prisma.watchSession.count({ where: { ...videoWhere, flagged: true } }),
      ]);
      return { views, completions, pointsAwarded: pointsAgg._sum.points ?? 0, flaggedSessions };
    },
  };
}
