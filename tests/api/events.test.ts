import { afterAll, describe, expect, it } from "vitest";
import { POST as postSessions } from "@/app/api/sessions/route";
import { POST as postEvents } from "@/app/api/sessions/[id]/events/route";
import { prisma } from "@/backend/lib/prisma";
import { authedRequest, createTestVideo, newUserId, paramsOf, postJson } from "./helpers";

async function createSession(userId: string, videoId?: string) {
  const video = videoId ?? (await createTestVideo()).id;
  const res = await postSessions(postJson("http://t/api/sessions", { videoId: video }, { userId }));
  return (await res.json()) as { sessionId: string; video: { id: string } };
}

describe("POST /api/sessions/:id/events", () => {
  afterAll(() => prisma.$disconnect());

  it("applies a batch of PLAY/TICK events and returns the documented result shape", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);

    const res = await postEvents(
      postJson(
        `http://t/api/sessions/${sessionId}/events`,
        { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] },
        { userId },
      ),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ state: "PLAYING", positionSec: 0, furthestSec: 0, lastSeq: 1, currentQuestionId: null });
    expect(body.results).toEqual([{ seq: 1, accepted: true, rejectReason: null }]);
  });

  it("403 NOT_OWNER when the session belongs to another user", async () => {
    const owner = newUserId();
    const { sessionId } = await createSession(owner);

    const res = await postEvents(
      postJson(`http://t/api/sessions/${sessionId}/events`, { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] }, { userId: newUserId() }),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_OWNER");
  });

  it("403 NOT_OWNER for a session id that doesn't exist", async () => {
    const res = await postEvents(
      postJson("http://t/api/sessions/does-not-exist/events", { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] }),
      paramsOf("does-not-exist"),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_OWNER");
  });

  it("400 VALIDATION_ERROR when seq is not strictly increasing", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const res = await postEvents(
      postJson(
        `http://t/api/sessions/${sessionId}/events`,
        { events: [{ seq: 2, type: "TICK", positionSec: 1 }, { seq: 1, type: "TICK", positionSec: 2 }] },
        { userId },
      ),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR for more than 20 events in one request", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const events = Array.from({ length: 21 }, (_, i) => ({ seq: i + 1, type: "TICK", positionSec: i }));
    const res = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, { events }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("413 BODY_TOO_LARGE for a body over 16 KB", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const events = [{ seq: 1, type: "TICK", positionSec: 1, clientAt: "x".repeat(20_000) }];
    const res = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, { events }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("BODY_TOO_LARGE");
  });

  it("429 EVENT_LIMIT when the session's 2000-event floor would be exceeded (short video)", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId); // default durationSec 44 → cap floor 2000
    await prisma.watchSession.update({ where: { id: sessionId }, data: { eventCount: 1995 } });

    const events = Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, type: "TICK", positionSec: i }));
    const res = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, { events }, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("EVENT_LIMIT");
  });

  it("the cap scales with duration for long videos: max(2000, ceil(durationSec × 3))", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId, (await createTestVideo({ durationSec: 2000 })).id); // cap = 6000
    await prisma.watchSession.update({ where: { id: sessionId }, data: { eventCount: 5995 } });

    const under = Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, type: "TICK", positionSec: i })); // 5995+5=6000, at the cap
    const okRes = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, { events: under }, { userId }), paramsOf(sessionId));
    expect(okRes.status).toBe(200);

    const over = [{ seq: 6, type: "TICK", positionSec: 6 }]; // 6000+1=6001, over the cap
    const capRes = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, { events: over }, { userId }), paramsOf(sessionId));
    expect(capRes.status).toBe(429);
    expect((await capRes.json()).error.code).toBe("EVENT_LIMIT");
  });

  it("a pure retry (all seqs already stored) is exempt from the event cap", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const batch = { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] };
    await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, batch, { userId }), paramsOf(sessionId));
    await prisma.watchSession.update({ where: { id: sessionId }, data: { eventCount: 2000 } }); // already at the cap

    const res = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, batch, { userId }), paramsOf(sessionId));
    expect(res.status).toBe(200); // retry of seq 1 only — no new events, cap never checked
  });

  it("409 SEQ_CONFLICT when a stale seq doesn't match what's stored, with recovery fields", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    await postEvents(
      postJson(`http://t/api/sessions/${sessionId}/events`, { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] }, { userId }),
      paramsOf(sessionId),
    );

    // Resend seq 1, but claiming a different position than what was actually stored.
    const res = await postEvents(
      postJson(`http://t/api/sessions/${sessionId}/events`, { events: [{ seq: 1, type: "PLAY", positionSec: 9 }] }, { userId }),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("SEQ_CONFLICT");
    expect(body.error).toMatchObject({ lastSeq: 1, state: "PLAYING", positionSec: 0, furthestSec: 0 });
  });

  it("recovers from a lost response: resending the exact same batch returns the same result and does not double-apply", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const batch = { events: [{ seq: 1, type: "PLAY", positionSec: 0 }, { seq: 2, type: "TICK", positionSec: 3 }] };

    const first = await (await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, batch, { userId }), paramsOf(sessionId))).json();

    // Simulate the client never seeing `first` (network loss) and retrying the identical batch.
    const retryRes = await postEvents(postJson(`http://t/api/sessions/${sessionId}/events`, batch, { userId }), paramsOf(sessionId));
    expect(retryRes.status).toBe(200);
    const retry = await retryRes.json();
    expect(retry).toEqual(first);

    const row = await prisma.watchSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.furthestSec).toBe(3); // not 6 — the retry did not re-apply the TICK
    expect(row.lastSeq).toBe(2);
  });

  it("recovers a partially-lost batch: echoes the already-stored prefix and applies only the new tail", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    await postEvents(
      postJson(`http://t/api/sessions/${sessionId}/events`, { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] }, { userId }),
      paramsOf(sessionId),
    );

    // Resend seq 1 (already stored, matches) together with a genuinely new seq 2.
    const res = await postEvents(
      postJson(
        `http://t/api/sessions/${sessionId}/events`,
        { events: [{ seq: 1, type: "PLAY", positionSec: 0 }, { seq: 2, type: "TICK", positionSec: 1 }] },
        { userId },
      ),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { seq: 1, accepted: true, rejectReason: null },
      { seq: 2, accepted: true, rejectReason: null },
    ]);
    expect(body.furthestSec).toBe(1);
    expect(body.lastSeq).toBe(2);
  });

  it("400 VALIDATION_ERROR for an unknown event type", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const res = await postEvents(
      postJson(`http://t/api/sessions/${sessionId}/events`, { events: [{ seq: 1, type: "NOPE", positionSec: 0 }] }, { userId }),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("400 VALIDATION_ERROR for a non-finite position", async () => {
    const userId = newUserId();
    const { sessionId } = await createSession(userId);
    const res = await postEvents(
      authedRequest(`http://t/api/sessions/${sessionId}/events`, {
        method: "POST",
        userId,
        body: JSON.stringify({ events: [{ seq: 1, type: "TICK", positionSec: null }] }),
      }),
      paramsOf(sessionId),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
