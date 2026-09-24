import { applyResume, decideResume } from "@/backend/domain/resume-policy";
import { applyAnswer as applyAnswerDomain, applyClientEvents } from "@/backend/domain/session-state-machine";
import type { ClientEvent, VideoRules } from "@/backend/domain/types";
import { AppError } from "@/backend/common/errors/app-error";
import { EVENT_CAPS } from "@/shared/constants/session";
import type { ClientEventType, SessionState } from "@/shared/constants/session";
import type { PublicQuestion, QuizRepository } from "../quiz/quiz.interface";
import type { UserRepository } from "../user/user.interface";
import type { VideoRepository, VideoRow } from "../video/video.interface";
import type { EventInput, SessionRow, WatchSessionRepository } from "./watch-session.interface";

export interface EventInputBody {
  seq: number;
  type: ClientEventType;
  positionSec: number;
  clientAt?: string;
}

export interface SessionResponseVideo {
  id: string;
  youtubeId: string;
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
}

export interface SessionCreateResult {
  sessionId: string;
  state: SessionState;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  isReplay: boolean;
  alreadyRewarded: boolean;
  currentQuestionId: string | null;
  passedQuestionIds: string[];
  video: SessionResponseVideo;
  quizzes: PublicQuestion[];
}

export interface EventsApplyResult {
  state: SessionState;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  currentQuestionId: string | null;
  results: Array<{ seq: number; accepted: boolean; rejectReason: string | null }>;
}

export interface AnswerApplyResult {
  correct: boolean;
  state: SessionState;
}

function toVideoRules(video: VideoRow, questions: PublicQuestion[]): VideoRules {
  return { durationSec: video.durationSec, questions: questions.map((q) => ({ id: q.id, triggerSec: q.triggerSec })) };
}

function toResponseVideo(video: VideoRow): SessionResponseVideo {
  return {
    id: video.id,
    youtubeId: video.youtubeId,
    title: video.title,
    channelName: video.channelName,
    durationSec: video.durationSec,
    rewardPoints: video.rewardPoints,
  };
}

function parseClientAt(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** max(floor, ceil(durationSec × rate)) — plan §10: long videos must stay finishable. */
function sessionEventCap(durationSec: number): number {
  return Math.max(EVENT_CAPS.MAX_EVENTS_PER_SESSION, Math.ceil(durationSec * EVENT_CAPS.EVENTS_PER_DURATION_SEC));
}

export interface WatchSessionService {
  createOrResume(userId: string, videoId: string): Promise<SessionCreateResult>;
  applyEvents(sessionId: string, userId: string, events: EventInputBody[]): Promise<EventsApplyResult>;
  applyAnswer(sessionId: string, userId: string, questionId: string, choice: string): Promise<AnswerApplyResult>;
}

export function createWatchSessionService(deps: {
  sessionRepo: WatchSessionRepository;
  videoRepo: VideoRepository;
  quizRepo: QuizRepository;
  userRepo: UserRepository;
}): WatchSessionService {
  async function loadOwned(sessionId: string, userId: string): Promise<SessionRow> {
    const row = await deps.sessionRepo.findById(sessionId);
    if (!row || row.userId !== userId) throw new AppError("NOT_OWNER", "not your session");
    return row;
  }

  /**
   * Resume rule 4: a PLAYING session becomes PAUSED, recorded as a RESUME audit row. Retried
   * once against the fresh row on a lost CAS race, so a PLAYING row never comes back unconverted
   * (mirrors /answer's retry — no conflict code is documented for this path either).
   */
  async function resumeSession(sessionId: string): Promise<SessionRow> {
    let row = await deps.sessionRepo.findById(sessionId);
    if (!row) throw new Error(`resume target session ${sessionId} vanished`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const { session: nextSnapshot, event } = applyResume(row);
      if (!event) return row; // benign: nothing to do unless it was PLAYING
      const result = await deps.sessionRepo.casUpdate(sessionId, row.version, nextSnapshot, { lastSeq: row.lastSeq, eventCountDelta: 0 }, [
        { ...event, clientAt: null },
      ]);
      if (result.applied) return { ...row, ...nextSnapshot, version: row.version + 1 };
      row = result.current; // retry once against the fresh row (still might be PLAYING)
    }
    throw new Error(`could not apply RESUME for session ${sessionId} after retries`);
  }

  return {
    async createOrResume(userId, videoId) {
      const video = await deps.videoRepo.findById(videoId);
      if (!video || video.status === "draft") throw new AppError("VIDEO_NOT_FOUND", "video not found");

      const existing = await deps.sessionRepo.findExistingForUserVideo(userId, videoId);
      const videoRewarded = existing.some((s) => s.rewarded);
      const decision = decideResume(video.status, existing, videoRewarded);
      if (decision.action === "not_found") throw new AppError("VIDEO_NOT_FOUND", "video not found");

      await deps.userRepo.ensure(userId);
      const session =
        decision.action === "resume" ? await resumeSession(decision.sessionId) : await deps.sessionRepo.create(userId, videoId, decision.isReplay);

      const quizzes = await deps.quizRepo.listForVideo(videoId);
      return {
        sessionId: session.id,
        state: session.state,
        positionSec: session.positionSec,
        furthestSec: session.furthestSec,
        lastSeq: session.lastSeq,
        isReplay: session.isReplay,
        alreadyRewarded: videoRewarded,
        currentQuestionId: session.currentQuestionId,
        passedQuestionIds: session.passedQuestionIds,
        video: toResponseVideo(video),
        quizzes,
      };
    },

    async applyEvents(sessionId, userId, events) {
      const row = await loadOwned(sessionId, userId);

      // A prefix of the batch may be a retry of an already-accepted request (network loss on
      // the previous response): seqs are validated strictly increasing, so once we see one
      // past lastSeq, every following one is new too (plan §4.2).
      const echoed: EventsApplyResult["results"] = [];
      let splitAt = 0;
      for (; splitAt < events.length && events[splitAt].seq <= row.lastSeq; splitAt++) {
        const e = events[splitAt];
        const stored = await deps.sessionRepo.findStoredEvent(sessionId, e.seq);
        if (!stored || stored.type !== e.type || stored.positionSec !== e.positionSec) {
          throw new AppError("SEQ_CONFLICT", "seq does not match a stored event", {
            lastSeq: row.lastSeq,
            state: row.state,
            positionSec: row.positionSec,
            furthestSec: row.furthestSec,
          });
        }
        echoed.push({ seq: stored.seq, accepted: stored.accepted, rejectReason: stored.rejectReason });
      }
      const newEvents = events.slice(splitAt);
      if (newEvents.length === 0) {
        // Pure retry of an already-applied batch: nothing to write, just echo the stored outcome.
        return {
          state: row.state,
          positionSec: row.positionSec,
          furthestSec: row.furthestSec,
          lastSeq: row.lastSeq,
          currentQuestionId: row.currentQuestionId,
          results: echoed,
        };
      }

      const video = await deps.videoRepo.findById(row.videoId);
      if (!video) throw new AppError("VIDEO_NOT_FOUND", "video not found");

      // The cap applies only to genuinely new events (plan §10) — a retried batch (handled
      // above) never counts against it twice.
      if (row.eventCount + newEvents.length > sessionEventCap(video.durationSec)) {
        throw new AppError("EVENT_LIMIT", "session has reached its event cap");
      }

      const questions = await deps.quizRepo.listForVideo(row.videoId);
      const domainEvents: ClientEvent[] = newEvents.map((e) => ({ seq: e.seq, type: e.type, positionSec: e.positionSec }));

      const serverAt = new Date();
      const { session: nextSnapshot, events: newRecords } = applyClientEvents(row, toVideoRules(video, questions), domainEvents, serverAt);

      const newLastSeq = newEvents.length > 0 ? newEvents[newEvents.length - 1].seq : row.lastSeq;
      const inputEvents: EventInput[] = newRecords.map((r, i) => ({ ...r, clientAt: parseClientAt(newEvents[i].clientAt) }));
      const write = await deps.sessionRepo.casUpdate(
        sessionId,
        row.version,
        nextSnapshot,
        { lastSeq: newLastSeq, eventCountDelta: newEvents.length },
        inputEvents,
      );

      if (!write.applied) {
        throw new AppError("SEQ_CONFLICT", "concurrent write", {
          lastSeq: write.current.lastSeq,
          state: write.current.state,
          positionSec: write.current.positionSec,
          furthestSec: write.current.furthestSec,
        });
      }

      const results = [...echoed, ...newRecords.map((r) => ({ seq: r.seq!, accepted: r.accepted, rejectReason: r.rejectReason }))];
      return {
        state: nextSnapshot.state,
        positionSec: nextSnapshot.positionSec,
        furthestSec: nextSnapshot.furthestSec,
        lastSeq: newLastSeq,
        currentQuestionId: nextSnapshot.currentQuestionId,
        results,
      };
    },

    async applyAnswer(sessionId, userId, questionId, choice) {
      const first = await loadOwned(sessionId, userId);
      const question = await deps.quizRepo.findForAnswer(questionId);
      if (!question || question.videoId !== first.videoId) throw new AppError("NOT_AT_QUIZ", "not waiting on this question");

      const video = await deps.videoRepo.findById(first.videoId);
      if (!video) throw new AppError("VIDEO_NOT_FOUND", "video not found");
      const cap = sessionEventCap(video.durationSec);

      // No conflict code is documented for this endpoint (plan §4.1) — a lost CAS race here is
      // rare (some other write landing between our read and write) and is retried server-side
      // against the fresh row, rather than surfacing an error code the client can't handle.
      let row = first;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (row.eventCount + 1 > cap) throw new AppError("EVENT_LIMIT", "session has reached its event cap");
        const result = applyAnswerDomain(row, question, choice);
        if (!result.ok) {
          throw result.code === "INVALID_CHOICE"
            ? new AppError("INVALID_CHOICE", "unknown choice label")
            : new AppError("NOT_AT_QUIZ", "not waiting on this question");
        }
        const write = await deps.sessionRepo.casUpdate(sessionId, row.version, result.session, { lastSeq: row.lastSeq, eventCountDelta: 1 }, [
          { ...result.event, clientAt: null },
        ]);
        if (write.applied) return { correct: result.correct, state: result.session.state };
        row = write.current;
      }
      throw new Error(`could not apply ANSWER for session ${sessionId} after retries`);
    },
  };
}
