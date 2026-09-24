import type { EventRecord, SessionSnapshot } from "@/backend/domain/types";
import type { ExistingSession } from "@/backend/domain/resume-policy";
import type { EventType, RejectReason } from "@/shared/constants/session";

/** The full row read back from WatchSession, decoded for the domain + service layer. */
export interface SessionRow extends SessionSnapshot {
  id: string;
  userId: string;
  videoId: string;
  lastSeq: number;
  version: number;
  eventCount: number;
  startedAt: Date;
}

export interface StoredEvent {
  seq: number;
  type: EventType;
  positionSec: number;
  accepted: boolean;
  rejectReason: RejectReason | null;
}

/** What a CAS write persists beyond the domain snapshot itself. */
export interface CasWriteMeta {
  /** New `lastSeq` — unchanged when no new client events were accepted/rejected this write. */
  lastSeq: number;
  /** How much to bump `eventCount` by (client `events` writes only — never ANSWER/CLAIM/RESUME). */
  eventCountDelta: number;
}

export type CasWriteResult = { applied: true } | { applied: false; current: SessionRow };

/** A domain audit record plus the client-reported timestamp (display only — plan §3). */
export interface EventInput extends EventRecord {
  clientAt: Date | null;
}

export interface WatchSessionRepository {
  findById(id: string): Promise<SessionRow | null>;
  /** All of this user's sessions for this video, any state, for resume-policy (plan §4.3). */
  findExistingForUserVideo(userId: string, videoId: string): Promise<ExistingSession[]>;
  create(userId: string, videoId: string, isReplay: boolean): Promise<SessionRow>;
  /** The stored outcome of a previously-accepted client seq, for idempotent-retry detection (plan §4.2). */
  findStoredEvent(sessionId: string, seq: number): Promise<StoredEvent | null>;
  /**
   * Optimistic-concurrency write (plan §4.2): `updateMany({ id, version: expectedVersion })`,
   * then `createMany(events)` only if exactly one row matched. `applied: false` carries the
   * current row so the caller can build a 409 SEQ_CONFLICT response without a second read.
   */
  casUpdate(id: string, expectedVersion: number, snapshot: SessionSnapshot, meta: CasWriteMeta, events: EventInput[]): Promise<CasWriteResult>;
}
