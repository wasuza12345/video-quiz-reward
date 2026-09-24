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

export function createAnalyticsRepository(): AnalyticsRepository {
  return {
    async listUsers(page, pageSize) {
      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { points: { select: { points: true } }, sessions: { select: { startedAt: true } } },
        }),
        prisma.user.count(),
      ]);
      const items: AdminUserListRow[] = rows.map((u) => ({
        id: u.id,
        createdAt: u.createdAt,
        totalPoints: u.points.reduce((sum, p) => sum + p.points, 0),
        sessionCount: u.sessions.length,
        lastActiveAt: u.sessions.length > 0 ? new Date(Math.max(...u.sessions.map((s) => s.startedAt.getTime()))) : null,
      }));
      return { items, total };
    },

    async findUserDetail(userId): Promise<AdminUserDetailData | null> {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return null;

      const [ledgerRows, sessionRows] = await Promise.all([
        prisma.pointsLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { video: { select: { title: true } } } }),
        prisma.watchSession.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, include: SESSION_INCLUDE }),
      ]);

      return {
        id: user.id,
        createdAt: user.createdAt,
        totalPoints: ledgerRows.reduce((sum, l) => sum + l.points, 0),
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
