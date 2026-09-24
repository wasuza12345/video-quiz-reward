"use client";

import { useCallback, useMemo } from "react";
import type { AnswerResponse, ClaimResponse, ClientEventType, EventsApplyResponse } from "@/shared/contracts/session";
import { api, ApiError } from "../services/api";
import type { WatchAction } from "../state/watch.actions";
import { SessionWriter, type PostEventsFn } from "./session-writer-core";

export interface SessionWriterApi {
  queueTick: (positionSec: number, clientAt?: string) => void;
  flushTicks: () => Promise<EventsApplyResponse | null>;
  sendImmediate: (
    type: Exclude<ClientEventType, "TICK">,
    positionSec: number,
    clientAt?: string,
    opts?: { keepalive?: boolean },
  ) => Promise<EventsApplyResponse | null>;
  sendAnswer: (questionId: string, choice: string) => Promise<AnswerResponse | { failed: true; code: "network" | "INVALID_CHOICE" | "NOT_AT_QUIZ" }>;
  sendClaim: () => Promise<ClaimResponse | { failed: true; reason: "network" | "not_ended" }>;
  isInFlight: () => boolean;
}

function makePost(sessionId: string): PostEventsFn {
  return async (events, opts) => {
    try {
      const result = await api.postEvents(
        sessionId,
        events.map((e) => ({ seq: e.seq, type: e.type, positionSec: e.positionSec, clientAt: e.clientAt })),
        opts,
      );
      return { ok: true, result };
    } catch (err) {
      if (err instanceof ApiError && err.code === "SEQ_CONFLICT") {
        return {
          ok: false,
          conflict: {
            lastSeq: err.extra.lastSeq as number,
            state: err.extra.state as EventsApplyResponse["state"],
            positionSec: err.extra.positionSec as number,
            furthestSec: err.extra.furthestSec as number,
          },
        };
      }
      throw err;
    }
  };
}

/**
 * Wraps SessionWriter for React: creates one per sessionId (starting its seq counter past the
 * session's already-confirmed lastSeq, e.g. after a refresh — MAJOR 1), dispatches EVENTS_SYNCED
 * on every accepted response and SEQ_CONFLICT on every 409, both centrally.
 */
export function useSessionWriter(sessionId: string | null, initialLastSeq: number, dispatch: React.Dispatch<WatchAction>): SessionWriterApi {
  const writer = useMemo(
    () => (sessionId ? new SessionWriter(makePost(sessionId), initialLastSeq) : null),
    // initialLastSeq is intentionally read only at creation time (it changes on every accepted
    // write afterward; re-memoizing on it would reset the writer's seq counter mid-session).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const interpret = useCallback(
    (outcome: Awaited<ReturnType<SessionWriter["flush"]>>): EventsApplyResponse | null => {
      if (!outcome) return null;
      if (outcome.kind === "ok") {
        dispatch({
          type: "EVENTS_SYNCED",
          state: outcome.result.state,
          positionSec: outcome.result.positionSec,
          furthestSec: outcome.result.furthestSec,
          currentQuestionId: outcome.result.currentQuestionId,
        });
        return outcome.result;
      }
      if (outcome.kind === "conflict") {
        dispatch({ type: "SEQ_CONFLICT", state: outcome.conflict.state, positionSec: outcome.conflict.positionSec, furthestSec: outcome.conflict.furthestSec });
        return null;
      }
      return null; // network error — left for offline/online detection to surface
    },
    [dispatch],
  );

  const queueTick = useCallback<SessionWriterApi["queueTick"]>((positionSec, clientAt) => writer?.queueTick(positionSec, clientAt), [writer]);

  const flushTicks = useCallback<SessionWriterApi["flushTicks"]>(async () => {
    if (!writer) return null;
    return interpret(await writer.flush());
  }, [writer, interpret]);

  const sendImmediate = useCallback<SessionWriterApi["sendImmediate"]>(
    async (type, positionSec, clientAt, opts) => {
      if (!writer) return null;
      return interpret(await writer.sendImmediate(type, positionSec, clientAt, opts));
    },
    [writer, interpret],
  );

  const sendAnswer = useCallback<SessionWriterApi["sendAnswer"]>(
    async (questionId, choice) => {
      if (!writer || !sessionId) return { failed: true, code: "network" };
      try {
        return await writer.runExclusive(() => api.postAnswer(sessionId, questionId, choice));
      } catch (err) {
        if (err instanceof ApiError && (err.code === "INVALID_CHOICE" || err.code === "NOT_AT_QUIZ")) {
          return { failed: true, code: err.code };
        }
        return { failed: true, code: "network" };
      }
    },
    [writer, sessionId],
  );

  const sendClaim = useCallback<SessionWriterApi["sendClaim"]>(async () => {
    if (!writer || !sessionId) return { failed: true, reason: "network" };
    try {
      return await writer.runExclusive(() => api.postClaim(sessionId));
    } catch (err) {
      if (err instanceof ApiError && err.code === "NOT_ENDED") return { failed: true, reason: "not_ended" };
      return { failed: true, reason: "network" };
    }
  }, [writer, sessionId]);

  const isInFlight = useCallback(() => writer?.isInFlight ?? false, [writer]);

  return { queueTick, flushTicks, sendImmediate, sendAnswer, sendClaim, isInFlight };
}
