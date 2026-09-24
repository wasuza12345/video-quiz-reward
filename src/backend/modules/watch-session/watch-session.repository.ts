import { prisma } from "@/backend/lib/prisma";
import type { SessionSnapshot } from "@/backend/domain/types";
import type { ExistingSession } from "@/backend/domain/resume-policy";
import type { SessionState } from "@/shared/constants/session";
import type { CasWriteMeta, CasWriteResult, EventInput, SessionRow, StoredEvent, WatchSessionRepository } from "./watch-session.interface";

type PrismaSessionRow = {
  id: string;
  userId: string;
  videoId: string;
  isReplay: boolean;
  state: string;
  currentQuestionId: string | null;
  passedQuestionIds: string;
  positionSec: number;
  furthestSec: number;
  playedWallSec: number;
  bankSec: number;
  lastPlayingAt: Date | null;
  softRejectCount: number;
  flagged: boolean;
  endedAt: Date | null;
  lastSeq: number;
  version: number;
  eventCount: number;
  startedAt: Date;
};

function toRow(r: PrismaSessionRow): SessionRow {
  return {
    id: r.id,
    userId: r.userId,
    videoId: r.videoId,
    isReplay: r.isReplay,
    state: r.state as SessionState,
    currentQuestionId: r.currentQuestionId,
    passedQuestionIds: JSON.parse(r.passedQuestionIds) as string[],
    positionSec: r.positionSec,
    furthestSec: r.furthestSec,
    playedWallSec: r.playedWallSec,
    bankSec: r.bankSec,
    lastPlayingAt: r.lastPlayingAt,
    softRejectCount: r.softRejectCount,
    flagged: r.flagged,
    endedAt: r.endedAt,
    lastSeq: r.lastSeq,
    version: r.version,
    eventCount: r.eventCount,
    startedAt: r.startedAt,
  };
}

function snapshotData(s: SessionSnapshot) {
  return {
    state: s.state,
    currentQuestionId: s.currentQuestionId,
    passedQuestionIds: JSON.stringify(s.passedQuestionIds),
    positionSec: s.positionSec,
    furthestSec: s.furthestSec,
    playedWallSec: s.playedWallSec,
    bankSec: s.bankSec,
    lastPlayingAt: s.lastPlayingAt,
    softRejectCount: s.softRejectCount,
    flagged: s.flagged,
    endedAt: s.endedAt,
  };
}

export function createWatchSessionRepository(): WatchSessionRepository {
  return {
    async findById(id) {
      const row = await prisma.watchSession.findUnique({ where: { id } });
      return row ? toRow(row) : null;
    },

    async findExistingForUserVideo(userId, videoId): Promise<ExistingSession[]> {
      const sessions = await prisma.watchSession.findMany({
        where: { userId, videoId },
        select: { id: true, isReplay: true, state: true, startedAt: true },
      });
      if (sessions.length === 0) return [];
      const rewardedRows = await prisma.pointsLedger.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        select: { sessionId: true },
      });
      const rewardedIds = new Set(rewardedRows.map((r) => r.sessionId));
      return sessions.map((s) => ({
        id: s.id,
        isReplay: s.isReplay,
        state: s.state as SessionState,
        startedAt: s.startedAt,
        rewarded: rewardedIds.has(s.id),
      }));
    },

    async create(userId, videoId, isReplay) {
      const row = await prisma.watchSession.create({ data: { userId, videoId, isReplay } });
      return toRow(row);
    },

    async findStoredEvent(sessionId, seq): Promise<StoredEvent | null> {
      const row = await prisma.watchEvent.findUnique({ where: { sessionId_seq: { sessionId, seq } } });
      if (!row || row.seq === null) return null;
      return {
        seq: row.seq,
        type: row.type as StoredEvent["type"],
        positionSec: row.positionSec,
        accepted: row.accepted,
        rejectReason: row.rejectReason as StoredEvent["rejectReason"],
      };
    },

    async casUpdate(id, expectedVersion, snapshot, meta: CasWriteMeta, events: EventInput[]): Promise<CasWriteResult> {
      const result = await prisma.watchSession.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...snapshotData(snapshot),
          lastSeq: meta.lastSeq,
          eventCount: { increment: meta.eventCountDelta },
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await prisma.watchSession.findUniqueOrThrow({ where: { id } });
        return { applied: false, current: toRow(current) };
      }
      if (events.length > 0) {
        await prisma.watchEvent.createMany({
          data: events.map((e) => ({
            sessionId: id,
            seq: e.seq,
            type: e.type,
            positionSec: e.positionSec,
            clientAt: e.clientAt,
            accepted: e.accepted,
            rejectReason: e.rejectReason,
            fromState: e.fromState,
            toState: e.toState,
            payload: e.payload ? JSON.stringify(e.payload) : null,
          })),
        });
      }
      return { applied: true };
    },
  };
}
