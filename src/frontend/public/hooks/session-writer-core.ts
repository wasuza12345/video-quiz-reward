// The write queue + seq bookkeeping + 409 recovery from plan §4.2, as a plain class with no React
// or fetch dependency — so it can be unit-tested directly (renders/effects live in useSessionWriter).
import { EVENT_CAPS } from "@/shared/constants/session";
import type { ClientEventBody, ClientEventType, EventsApplyResponse, SessionState } from "@/shared/contracts/session";

export type QueuedEvent = ClientEventBody;

export interface SeqConflictInfo {
  lastSeq: number;
  state: SessionState;
  positionSec: number;
  furthestSec: number;
}

export type PostEventsResult = { ok: true; result: EventsApplyResponse } | { ok: false; conflict: SeqConflictInfo };
export type PostOpts = { keepalive?: boolean };
export type PostEventsFn = (events: QueuedEvent[], opts?: PostOpts) => Promise<PostEventsResult>;

export type FlushOutcome = { kind: "ok"; result: EventsApplyResponse } | { kind: "conflict"; conflict: SeqConflictInfo } | { kind: "error" };

/**
 * One write in flight per session (plan §4.2): events, answer and claim all share this lock via
 * `runExclusive`. Immediate events (PLAY/PAUSE/TAB_HIDDEN/ENDED/SEEK) flush right away or, if a
 * write is already in flight, wait for it and then send for real — never silently dropped. TICKs
 * are only ever sent by the caller's own periodic flush (queueTick never sends by itself).
 */
export class SessionWriter {
  private nextSeq: number;
  private queue: QueuedEvent[] = [];
  private locked = false;
  private waiters: Array<() => void> = [];
  private currentPlayState: "PLAY" | "PAUSE" = "PAUSE";

  /** `initialLastSeq` resumes the counter past a session's already-confirmed seq (e.g. after a
   * refresh) so the first write doesn't restart at 1 and collide with stored events (MAJOR 1). */
  constructor(
    private readonly post: PostEventsFn,
    initialLastSeq = 0,
  ) {
    this.nextSeq = initialLastSeq + 1;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isInFlight(): boolean {
    return this.locked;
  }

  private allocSeq(): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return seq;
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }

  /** The shared lock: also used by answer/claim so nothing races an events write (plan §4.2). */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  queueTick(positionSec: number, clientAt?: string): void {
    this.queue.push({ seq: this.allocSeq(), type: "TICK", positionSec, clientAt });
  }

  /** Queues then flushes — used for PLAY/PAUSE/TAB_HIDDEN/ENDED/SEEK. */
  async sendImmediate(type: Exclude<ClientEventType, "TICK">, positionSec: number, clientAt?: string, opts?: PostOpts): Promise<FlushOutcome | null> {
    if (type === "PLAY" || type === "PAUSE") this.currentPlayState = type;
    this.queue.push({ seq: this.allocSeq(), type, positionSec, clientAt });
    return this.flush(opts);
  }

  /** Sends whatever is queued (≤20/request) once it's this write's turn. No-op if nothing is queued. */
  async flush(opts?: PostOpts): Promise<FlushOutcome | null> {
    if (this.queue.length === 0) return null;
    return this.runExclusive(async () => {
      if (this.queue.length === 0) return null; // drained by another flush while we waited for the lock
      const batch = this.queue.splice(0, EVENT_CAPS.MAX_EVENTS_PER_REQUEST);
      try {
        const res = await this.post(batch, opts);
        if (res.ok) return { kind: "ok", result: res.result };
        this.recoverFromConflict(res.conflict);
        // Flush the correction (if any) right away instead of waiting for the next interval (MAJOR 1).
        if (this.queue.length > 0) void this.flush();
        return { kind: "conflict", conflict: res.conflict };
      } catch {
        // Network/5xx: put the batch back ahead of anything queued meanwhile, retried next flush.
        this.queue.unshift(...batch);
        return { kind: "error" };
      }
    });
  }

  /**
   * 409 recovery (plan §4.2, never loops):
   * 1) drop every queued event with seq ≤ server lastSeq, and every remaining TICK (stale once
   *    position has jumped); 2) advance nextSeq past the server's; 3) the caller adopts server
   * state/position and seeks (SessionWriter doesn't touch the reducer/player); 4) if our own
   * play/pause intent now disagrees with the server, queue exactly one correcting event — never
   * a stale one, never a resend of what was just dropped.
   */
  private recoverFromConflict(conflict: SeqConflictInfo): void {
    this.queue = this.queue.filter((e) => e.type !== "TICK" && e.seq > conflict.lastSeq);
    this.nextSeq = Math.max(this.nextSeq - 1, conflict.lastSeq) + 1;

    const serverIsPlaying = conflict.state === "PLAYING";
    const weWantPlaying = this.currentPlayState === "PLAY";
    if (serverIsPlaying !== weWantPlaying) {
      this.queue.push({ seq: this.allocSeq(), type: weWantPlaying ? "PLAY" : "PAUSE", positionSec: conflict.positionSec });
    }
  }
}
