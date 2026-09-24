import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { GET as getUser } from "@/app/api/admin/users/[id]/route";
import { GET as listUsers } from "@/app/api/admin/users/route";
import { GET as getSession } from "@/app/api/admin/sessions/[id]/route";
import { GET as listSessions } from "@/app/api/admin/sessions/route";
import { GET as getStats } from "@/app/api/admin/stats/route";
import { issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { prisma } from "@/backend/lib/prisma";
import { adminRequest, createTestAdmin, createTestVideo, newUserId, paramsOf } from "./helpers";

async function issueCookie(adminId: string) {
  return issueAdminCookieValue({ adminId, tokenVersion: 0 });
}

async function adminCookie() {
  const admin = await createTestAdmin();
  return issueCookie(admin.id);
}

/** Arranges a WatchSession row directly (matches this suite's existing convention of touching
 * Prisma for fixture setup) — these tests are about the analytics *read* layer, not about
 * re-proving the session state machine, which tests/api/events.test.ts etc. already cover. */
async function createTestSession(
  videoId: string,
  overrides: Partial<{
    userId: string;
    state: string;
    flagged: boolean;
    isReplay: boolean;
    furthestSec: number;
    positionSec: number;
    playedWallSec: number;
    startedAt: Date;
    endedAt: Date | null;
  }> = {},
) {
  const userId = overrides.userId ?? newUserId();
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
  return prisma.watchSession.create({
    data: {
      userId,
      videoId,
      state: overrides.state ?? "ENDED",
      flagged: overrides.flagged ?? false,
      isReplay: overrides.isReplay ?? false,
      furthestSec: overrides.furthestSec ?? 44,
      positionSec: overrides.positionSec ?? 44,
      playedWallSec: overrides.playedWallSec ?? 40,
      startedAt: overrides.startedAt ?? new Date(),
      endedAt: overrides.endedAt ?? new Date(),
    },
  });
}

async function awardPoints(session: { id: string; userId: string; videoId: string }, points = 50) {
  return prisma.pointsLedger.create({ data: { userId: session.userId, videoId: session.videoId, sessionId: session.id, points, reason: "video_completed" } });
}

describe("GET /api/admin/users (plan §4.5, §5.5)", () => {
  afterAll(() => prisma.$disconnect());

  it("lists a user with totalPoints/sessionCount/lastActiveAt computed from their rows", async () => {
    const cookie = await adminCookie();
    const video = await createTestVideo();
    const userId = newUserId();
    const s1 = await createTestSession(video.id, { userId, startedAt: new Date(Date.now() - 60_000) });
    await createTestSession(video.id, { userId, startedAt: new Date() }); // more recent
    await awardPoints(s1, 50);

    const res = await listUsers(adminRequest(`http://t/api/admin/users?page=1&pageSize=100`, { method: "GET", adminCookie: cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.items.find((u: { id: string }) => u.id === userId);
    expect(row).toBeTruthy();
    expect(row.totalPoints).toBe(50);
    expect(row.sessionCount).toBe(2);
    expect(row.lastActiveAt).toBeTruthy();
  });

  it("paging", async () => {
    const cookie = await adminCookie();
    const res = await listUsers(adminRequest(`http://t/api/admin/users?page=1&pageSize=3`, { method: "GET", adminCookie: cookie }));
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(3);
    expect(body.items.length).toBeLessThanOrEqual(3);
  });
});

describe("GET /api/admin/users/:id", () => {
  afterAll(() => prisma.$disconnect());

  it("404 USER_NOT_FOUND for an unknown id", async () => {
    const cookie = await adminCookie();
    const res = await getUser(adminRequest("http://t/api/admin/users/unknown", { method: "GET", adminCookie: cookie }), paramsOf(randomUUID()));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("USER_NOT_FOUND");
  });

  it("returns the user's ledger and sessions", async () => {
    const cookie = await adminCookie();
    const video = await createTestVideo({ title: "Detail Video" });
    const userId = newUserId();
    const session = await createTestSession(video.id, { userId, flagged: true });
    await awardPoints(session, 50);

    const res = await getUser(adminRequest(`http://t/api/admin/users/${userId}`, { method: "GET", adminCookie: cookie }), paramsOf(userId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: userId, totalPoints: 50 });
    expect(body.ledger).toHaveLength(1);
    expect(body.ledger[0]).toMatchObject({ sessionId: session.id, videoId: video.id, videoTitle: "Detail Video", points: 50 });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ id: session.id, flagged: true });
  });
});

describe("GET /api/admin/sessions (plan §4.5, §5.6)", () => {
  afterAll(() => prisma.$disconnect());

  it("filters by videoId", async () => {
    const cookie = await adminCookie();
    const videoA = await createTestVideo();
    const videoB = await createTestVideo();
    await createTestSession(videoA.id);
    await createTestSession(videoB.id);

    const res = await listSessions(adminRequest(`http://t/api/admin/sessions?videoId=${videoA.id}&page=1&pageSize=50`, { method: "GET", adminCookie: cookie }));
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((s: { videoId: string }) => s.videoId === videoA.id)).toBe(true);
  });

  it("filters by flagged=true", async () => {
    const cookie = await adminCookie();
    const video = await createTestVideo();
    await createTestSession(video.id, { flagged: true });
    await createTestSession(video.id, { flagged: false });

    const res = await listSessions(adminRequest(`http://t/api/admin/sessions?videoId=${video.id}&flagged=true&page=1&pageSize=50`, { method: "GET", adminCookie: cookie }));
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((s: { flagged: boolean }) => s.flagged === true)).toBe(true);
  });

  it("session rows carry videoTitle and pointsAwarded", async () => {
    const cookie = await adminCookie();
    const video = await createTestVideo({ title: "Row Shape Video" });
    const session = await createTestSession(video.id);
    await awardPoints(session, 50);

    const res = await listSessions(adminRequest(`http://t/api/admin/sessions?videoId=${video.id}&page=1&pageSize=50`, { method: "GET", adminCookie: cookie }));
    const body = await res.json();
    const row = body.items.find((s: { id: string }) => s.id === session.id);
    expect(row).toMatchObject({ videoTitle: "Row Shape Video", pointsAwarded: 50, durationSec: video.durationSec });
  });
});

describe("GET /api/admin/sessions/:id (plan §4.5, §5.7)", () => {
  afterAll(() => prisma.$disconnect());

  it("404 SESSION_NOT_FOUND for an unknown id", async () => {
    const cookie = await adminCookie();
    const res = await getSession(adminRequest("http://t/api/admin/sessions/unknown", { method: "GET", adminCookie: cookie }), paramsOf(randomUUID()));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns full session facts plus its event timeline, ordered", async () => {
    const cookie = await adminCookie();
    const video = await createTestVideo();
    const session = await createTestSession(video.id, { furthestSec: 20 });
    const base = new Date();
    await prisma.watchEvent.create({
      data: { sessionId: session.id, seq: 2, type: "TICK", positionSec: 20, serverAt: new Date(base.getTime() + 1000), accepted: true, fromState: "PLAYING", toState: "PLAYING" },
    });
    await prisma.watchEvent.create({
      data: { sessionId: session.id, seq: 1, type: "PLAY", positionSec: 0, serverAt: base, accepted: true, fromState: "CREATED", toState: "PLAYING" },
    });

    const res = await getSession(adminRequest(`http://t/api/admin/sessions/${session.id}`, { method: "GET", adminCookie: cookie }), paramsOf(session.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toMatchObject({ id: session.id, furthestSec: 20, questionCount: 0, passedQuestionIds: [] });
    expect(body.events).toHaveLength(2);
    expect(body.events.map((e: { seq: number | null }) => e.seq)).toEqual([1, 2]); // ordered by serverAt, not insertion order
  });
});

describe("GET /api/admin/stats (plan §4.5, §5.2)", () => {
  afterAll(() => prisma.$disconnect());

  it("views = non-replay sessions, completions = ledger rows, pointsAwarded = sum, flaggedSessions = count", async () => {
    const cookie = await adminCookie();
    const video = await createTestVideo();
    const s1 = await createTestSession(video.id, { isReplay: false });
    await createTestSession(video.id, { isReplay: true }); // not a "view"
    await createTestSession(video.id, { flagged: true });
    await awardPoints(s1, 50);

    const res = await getStats(adminRequest(`http://t/api/admin/stats?videoId=${video.id}`, { method: "GET", adminCookie: cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.views).toBe(2); // s1 + the flagged one (both non-replay); the replay one excluded
    expect(body.completions).toBe(1);
    expect(body.pointsAwarded).toBe(50);
    expect(body.flaggedSessions).toBe(1);
  });

  it("without videoId, aggregates across all videos", async () => {
    const cookie = await adminCookie();
    const res = await getStats(adminRequest("http://t/api/admin/stats", { method: "GET", adminCookie: cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.views).toBe("number");
    expect(typeof body.pointsAwarded).toBe("number");
  });
});
