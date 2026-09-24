/** Shared shape for every admin session row, list or detail (plan §4.5's SessionRow). */
export interface SessionRowData {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  state: string;
  flagged: boolean;
  isReplay: boolean;
  furthestSec: number;
  durationSec: number;
  playedWallSec: number;
  pointsAwarded: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface AdminUserListRow {
  id: string;
  createdAt: Date;
  totalPoints: number;
  sessionCount: number;
  lastActiveAt: Date | null;
}

export interface AdminUserLedgerRowData {
  sessionId: string;
  videoId: string;
  videoTitle: string;
  points: number;
  createdAt: Date;
}

export interface AdminUserDetailData {
  id: string;
  createdAt: Date;
  totalPoints: number;
  ledger: AdminUserLedgerRowData[];
  sessions: SessionRowData[];
}

export interface AdminSessionEventData {
  id: number;
  seq: number | null;
  type: string;
  positionSec: number;
  clientAt: Date | null;
  serverAt: Date;
  accepted: boolean;
  rejectReason: string | null;
  fromState: string;
  toState: string;
  payload: string | null;
}

export interface AdminSessionDetailData {
  session: SessionRowData & {
    positionSec: number;
    bankSec: number;
    softRejectCount: number;
    passedQuestionIds: string[];
    currentQuestionId: string | null;
    questionCount: number;
    lastSeq: number;
    version: number;
    eventCount: number;
  };
  events: AdminSessionEventData[];
}

export interface AnalyticsStatsData {
  views: number;
  completions: number;
  pointsAwarded: number;
  flaggedSessions: number;
}

export interface SessionListFilter {
  videoId?: string;
  flagged?: boolean;
}

export interface AnalyticsRepository {
  listUsers(page: number, pageSize: number): Promise<{ items: AdminUserListRow[]; total: number }>;
  findUserDetail(userId: string): Promise<AdminUserDetailData | null>;
  listSessions(filter: SessionListFilter, page: number, pageSize: number): Promise<{ items: SessionRowData[]; total: number }>;
  findSessionDetail(sessionId: string): Promise<AdminSessionDetailData | null>;
  stats(videoId?: string): Promise<AnalyticsStatsData>;
}
