// Repo-level (not through the API): pins the interactive-transaction lock gate directly (review
// round 3) — the service already short-circuits before calling the repository when it *knows* a
// video is locked, so the only way to exercise the repository's own atomic gate-then-rollback is
// to call it directly with `requireUnlocked: true` against a video that actually has a session.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createQuizRepository } from "@/backend/modules/quiz/quiz.repository";
import { prisma } from "@/backend/lib/prisma";
import { createTestAdmin, createTestQuestion, createTestVideo } from "./helpers";

describe("QuizRepository.update — the atomic lock gate (review round 3)", () => {
  afterAll(() => prisma.$disconnect());

  it("a locked video → returns null (VIDEO_LOCKED, per the service), with no partial changes committed", async () => {
    const repo = createQuizRepository();
    const video = await createTestVideo({ durationSec: 60 });
    const question = await createTestQuestion(video.id, 10);
    const admin = await createTestAdmin();

    // What makes the video locked: a real WatchSession row.
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId } });
    await prisma.watchSession.create({ data: { userId, videoId: video.id, state: "CREATED" } });

    const auditCountBefore = await prisma.adminAuditLog.count({ where: { entityId: question.id } });

    const result = await repo.update(question.id, { triggerSec: 20, prompt: "should never land" }, { adminId: admin.id }, true);

    expect(result).toBeNull();

    // Neither the scalar change nor the audit row committed — the whole interactive transaction
    // rolled back at the gate, not just the part that would have violated the lock.
    const stored = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(stored.triggerSec).toBe(10);
    expect(stored.prompt).toBe("Test question?"); // helpers.ts's createTestQuestion fixture default

    const auditCountAfter = await prisma.adminAuditLog.count({ where: { entityId: question.id } });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("an unlocked video → the same call succeeds and commits scalar + audit together", async () => {
    const repo = createQuizRepository();
    const video = await createTestVideo({ durationSec: 60 });
    const question = await createTestQuestion(video.id, 10);
    const admin = await createTestAdmin();

    const result = await repo.update(question.id, { triggerSec: 20, prompt: "updated" }, { adminId: admin.id }, true);

    expect(result).not.toBeNull();
    expect(result?.triggerSec).toBe(20);
    expect(result?.prompt).toBe("updated");

    const row = await prisma.adminAuditLog.findFirst({ where: { entityId: question.id, action: "question.update" } });
    expect(row).toBeTruthy();
  });
});

describe("QuizRepository.delete — the atomic lock gate (review round 3)", () => {
  afterAll(() => prisma.$disconnect());

  it("a locked video → returns false, the question and no audit row are left in place", async () => {
    const repo = createQuizRepository();
    const video = await createTestVideo({ durationSec: 60 });
    const question = await createTestQuestion(video.id, 10);
    const admin = await createTestAdmin();

    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId } });
    await prisma.watchSession.create({ data: { userId, videoId: video.id, state: "CREATED" } });

    const deleted = await repo.delete(question.id, { adminId: admin.id });
    expect(deleted).toBe(false);

    expect(await prisma.quizQuestion.findUnique({ where: { id: question.id } })).not.toBeNull();
    expect(await prisma.adminAuditLog.count({ where: { entityId: question.id, action: "question.delete" } })).toBe(0);
  });
});
