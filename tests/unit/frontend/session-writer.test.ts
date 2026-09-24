import { describe, expect, it, vi } from "vitest";
import { SessionWriter, type PostEventsFn, type PostEventsResult, type QueuedEvent } from "@/frontend/public/hooks/session-writer-core";
import type { EventsApplyResponse } from "@/shared/contracts/session";

/** Drains pending microtasks (the writer's internal lock await) without depending on tick count. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function okResult(resultOver: Partial<EventsApplyResponse> = {}): PostEventsResult {
  const result: EventsApplyResponse = {
    state: "PLAYING",
    positionSec: 0,
    furthestSec: 0,
    lastSeq: 0,
    currentQuestionId: null,
    results: [],
    ...resultOver,
  };
  return { ok: true, result };
}

describe("SessionWriter — seq allocation and immediate flush", () => {
  it("allocates strictly increasing seqs starting at 1", async () => {
    const calls: QueuedEvent[][] = [];
    const post: PostEventsFn = async (events) => {
      calls.push(events);
      return okResult();
    };
    const w = new SessionWriter(post);
    w.queueTick(1);
    w.queueTick(2);
    await w.sendImmediate("PAUSE", 2);

    expect(calls).toHaveLength(1);
    expect(calls[0].map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(calls[0].map((e) => e.type)).toEqual(["TICK", "TICK", "PAUSE"]);
  });

  it("resumes past a session's already-confirmed lastSeq instead of restarting at 1 (review MAJOR 1)", async () => {
    const calls: QueuedEvent[][] = [];
    const post: PostEventsFn = async (events) => {
      calls.push(events);
      return okResult();
    };
    const w = new SessionWriter(post, 27); // e.g. resumed after a refresh, server already has lastSeq=27
    await w.sendImmediate("PLAY", 10);

    expect(calls[0]).toEqual([{ seq: 28, type: "PLAY", positionSec: 10, clientAt: undefined }]);
    // no 409: the mock always returns ok, so a real server (rejecting seq <= its lastSeq) would
    // likewise accept this seq 28 rather than colliding with an already-stored seq 1..27.
  });

  it("flush() is a no-op when nothing is queued", async () => {
    const post = vi.fn<PostEventsFn>(async () => okResult());
    const w = new SessionWriter(post);
    const outcome = await w.flush();
    expect(outcome).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("a second sendImmediate while one is in flight chains after it instead of racing", async () => {
    let resolveFirst!: (r: PostEventsResult) => void;
    const post = vi
      .fn<PostEventsFn>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(async () => okResult());
    const w = new SessionWriter(post);

    const firstSend = w.sendImmediate("PLAY", 0);
    await flushMicrotasks(); // let the internal lock's await resolve so post() actually runs and sets resolveFirst
    const secondSend = w.sendImmediate("PAUSE", 3); // queued while the first is in flight

    resolveFirst(okResult());
    const [first, second] = await Promise.all([firstSend, secondSend]);

    expect(first?.kind).toBe("ok");
    expect(second?.kind).toBe("ok"); // waited its turn, then actually sent — not dropped
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].map((e) => e.type)).toEqual(["PAUSE"]);
  });

  it("runExclusive shares the same lock as flush — answer/claim never race an events write (plan §4.2)", async () => {
    const order: string[] = [];
    let resolveEvents!: () => void;
    const post: PostEventsFn = () =>
      new Promise((resolve) => {
        resolveEvents = () => {
          order.push("events:start");
          resolve(okResult());
        };
      });
    const w = new SessionWriter(post);

    const eventsSend = w.sendImmediate("PLAY", 0);
    await flushMicrotasks(); // let the internal lock's await resolve so post() actually runs and sets resolveEvents
    const answerCall = w.runExclusive(async () => {
      order.push("answer:ran");
      return "answer-result";
    });

    expect(w.isInFlight).toBe(true);
    resolveEvents();
    const [, answerResult] = await Promise.all([eventsSend, answerCall]);

    expect(answerResult).toBe("answer-result");
    expect(order).toEqual(["events:start", "answer:ran"]); // answer waited for the events write to finish
  });
});

describe("SessionWriter — 409 recovery never loops (plan §4.2)", () => {
  it("drops every queued TICK and any seq ≤ lastSeq; a stable state needs no resend; a second flush makes no network call", async () => {
    const post: PostEventsFn = async () => ({
      ok: false,
      conflict: { lastSeq: 5, state: "PAUSED", positionSec: 9, furthestSec: 9 },
    });
    const w = new SessionWriter(post);
    w.queueTick(1);
    w.queueTick(2);
    // currentPlayState defaults to "PAUSE", matching the server's reported PAUSED — no resend needed.

    const outcome = await w.flush();
    expect(outcome).toEqual({ kind: "conflict", conflict: { lastSeq: 5, state: "PAUSED", positionSec: 9, furthestSec: 9 } });
    expect(w.pendingCount).toBe(0); // both stale TICKs dropped, no resend needed

    const second = await w.flush(); // nothing queued — no further network call, recovery terminated
    expect(second).toBeNull();
  });

  it("resends exactly one correcting PLAY when our intent disagrees with the server's PAUSED, flushed immediately rather than left for the next interval (review MAJOR 1)", async () => {
    const calls: QueuedEvent[][] = [];
    let call = 0;
    const post: PostEventsFn = async (events) => {
      call += 1;
      calls.push(events);
      if (call === 1) return { ok: false, conflict: { lastSeq: 5, state: "PAUSED", positionSec: 9, furthestSec: 9 } };
      return okResult({ state: "PLAYING", positionSec: 9, furthestSec: 9, lastSeq: 6 });
    };
    const w = new SessionWriter(post);
    w.queueTick(1); // seq 1 — will be dropped (stale TICK)
    w.queueTick(2); // seq 2 — will be dropped (stale TICK)
    await w.sendImmediate("PLAY", 2); // seq 3, currentPlayState = "PLAY"; this call triggers the conflict
    await flushMicrotasks(); // let the auto-triggered correction (queued behind the same lock) finish sending

    expect(calls[0].map((e) => e.seq)).toEqual([1, 2, 3]);
    // The correction was queued AND already sent by the time sendImmediate resolves — no waiting
    // for the next 5s interval (that was the old behavior; MAJOR 1 fixes it).
    expect(call).toBe(2);
    expect(calls[1]).toHaveLength(1);
    expect(calls[1][0]).toMatchObject({ seq: 6, type: "PLAY", positionSec: 9 }); // fresh seq past lastSeq 5, not 1/2/3
    expect(w.pendingCount).toBe(0);

    // No further network calls happen without new queued work — the recovery terminated.
    const third = await w.flush();
    expect(third).toBeNull();
    expect(call).toBe(2);
  });

  it("stale seqs are never resent even when new events are queued after a conflict", async () => {
    let call = 0;
    const seqsSeen: number[][] = [];
    const post: PostEventsFn = async (events) => {
      call += 1;
      seqsSeen.push(events.map((e) => e.seq));
      // state: "PAUSED" matches the writer's default play-state intent, so recovery queues no
      // correcting event here — isolates this test to just the seq/drop behavior.
      if (call === 1) return { ok: false, conflict: { lastSeq: 10, state: "PAUSED", positionSec: 20, furthestSec: 20 } };
      return okResult();
    };
    const w = new SessionWriter(post);
    w.queueTick(1);
    w.queueTick(2);
    w.queueTick(3);
    await w.flush(); // conflict: lastSeq 10 — all 3 TICKs (seq 1-3) dropped, nextSeq jumps to 11

    w.queueTick(21); // freshly queued after recovery
    await w.flush();

    expect(seqsSeen[0]).toEqual([1, 2, 3]);
    expect(seqsSeen[1]).toEqual([11]); // never re-sends 1, 2, or 3
  });

  it("network/5xx failure keeps the batch queued (retried on the next flush) instead of dropping it", async () => {
    let call = 0;
    const post: PostEventsFn = async () => {
      call += 1;
      if (call === 1) throw new Error("network down");
      return okResult();
    };
    const w = new SessionWriter(post);
    w.queueTick(1);
    const first = await w.flush();
    expect(first).toEqual({ kind: "error" });
    expect(w.pendingCount).toBe(1); // still queued, not lost

    const second = await w.flush();
    expect(second?.kind).toBe("ok");
    expect(w.pendingCount).toBe(0);
  });
});
