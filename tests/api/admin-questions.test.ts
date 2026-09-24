import { afterAll, describe, expect, it, vi } from "vitest";
import { PATCH as patchQuestion, DELETE as deleteQuestion } from "@/app/api/admin/questions/[id]/route";
import { POST as postSessions } from "@/app/api/sessions/route";
import { POST as createQuestion } from "@/app/api/admin/videos/[id]/questions/route";
import { POST as publishVideo } from "@/app/api/admin/videos/[id]/publish/route";
import { POST as createVideo } from "@/app/api/admin/videos/route";
import { issueAdminCookieValue } from "@/backend/common/auth/admin-session";
import { prisma } from "@/backend/lib/prisma";
import { adminRequest, createTestAdmin, newUserId, paramsOf, postJson } from "./helpers";

vi.mock("@/backend/lib/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/lib/youtube")>();
  return {
    ...actual,
    fetchYoutubeOembed: vi.fn(async (youtubeId: string) => ({ title: `title ${youtubeId}`, channelName: `channel ${youtubeId}` })),
  };
});

function randomYoutubeId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 11 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function issueCookie(adminId: string) {
  return issueAdminCookieValue({ adminId, tokenVersion: 0 });
}

async function createUnlockedVideo(durationSec = 60) {
  const admin = await createTestAdmin();
  const cookie = await issueCookie(admin.id);
  const created = await (
    await createVideo(adminRequest("http://t/api/admin/videos", { body: { youtubeUrl: randomYoutubeId(), durationSec, rewardPoints: 10 }, adminCookie: cookie }))
  ).json();
  return { cookie, video: created };
}

/** A video is only locked once it has a real WatchSession (plan §7) — but a session can only be
 * created on a *published* video (resume-policy: draft/archived both 404 new sessions), so this
 * publishes first. */
async function lockVideo(cookie: string, videoId: string) {
  await publishVideo(adminRequest(`http://t/api/admin/videos/${videoId}/publish`, { adminCookie: cookie }), paramsOf(videoId));
  const res = await postSessions(postJson("http://t/api/sessions", { videoId }, { userId: newUserId() }));
  if (res.status !== 200) throw new Error(`test setup: failed to create a locking session (status ${res.status})`);
}

const CHOICES_2 = [
  { label: "A", text: "a" },
  { label: "B", text: "b" },
];
const CHOICES_4 = [
  { label: "A", text: "a" },
  { label: "B", text: "b" },
  { label: "C", text: "c" },
  { label: "D", text: "d" },
];

describe("admin quiz question CRUD (plan §4.4/§4.5/§7)", () => {
  afterAll(() => prisma.$disconnect());

  it("creates a question with valid triggerSec/choices/correctChoice", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const res = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_4, correctChoice: "C" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ triggerSec: 10, prompt: "Q?", correctChoice: "C" });
    expect(body.choices).toEqual(CHOICES_4);
  });

  it("triggerSec >= durationSec - 2 → 422 INVALID_TRIGGER (the domain rule, reachable past zod's own >0 check)", async () => {
    const { cookie, video } = await createUnlockedVideo(20); // durationSec - 2 = 18
    const tooLate = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 19, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(tooLate.status).toBe(422);
    expect((await tooLate.json()).error.code).toBe("INVALID_TRIGGER");
  });

  it("triggerSec <= 0 is already rejected by the body schema (zod .positive()) → 400 VALIDATION_ERROR, never reaches the domain check", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const res = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 0, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("correctChoice not among the given choices' labels → 400 VALIDATION_ERROR", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const res = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "C" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("duplicate triggerSec within the same video → 409 DUPLICATE_TRIGGER", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const first = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q1?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(first.status).toBe(200);
    const second = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q2?", choices: CHOICES_2, correctChoice: "B" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("DUPLICATE_TRIGGER");
  });

  it("fewer than 2 or more than 4 choices → 400 VALIDATION_ERROR (zod)", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const oneChoice = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: [{ label: "A", text: "a" }], correctChoice: "A" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(oneChoice.status).toBe(400);
  });

  it("creating a question on a video with 0 sessions is allowed; on a LOCKED video → 409 VIDEO_LOCKED", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    await lockVideo(cookie, video.id);

    const res = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("VIDEO_LOCKED");
  });

  it("PATCH: prompt/choice text stay editable even when locked", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Original?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    await lockVideo(cookie, video.id); // locks the video

    const res = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { prompt: "Edited?", choices: [{ label: "A", text: "edited a" }, { label: "B", text: "b" }] }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompt).toBe("Edited?");
    expect(body.choices).toEqual([{ label: "A", text: "edited a" }, { label: "B", text: "b" }]);
  });

  it("PATCH on a LOCKED question: triggerSec change → 409 VIDEO_LOCKED", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    await lockVideo(cookie, video.id);

    const res = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { triggerSec: 15 }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("VIDEO_LOCKED");
  });

  it("PATCH on a LOCKED question: correctChoice change → 409 VIDEO_LOCKED", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    await lockVideo(cookie, video.id);

    const res = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { correctChoice: "B" }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(res.status).toBe(409);
  });

  it("PATCH on a LOCKED question: adding/removing a choice → 409 VIDEO_LOCKED; same-label-set text edits are fine", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    await lockVideo(cookie, video.id);

    const addChoice = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { choices: [...CHOICES_2, { label: "C", text: "c" }] }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(addChoice.status).toBe(409);

    const sameSetTextEdit = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { choices: [{ label: "A", text: "new a text" }, { label: "B", text: "b" }] }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(sameSetTextEdit.status).toBe(200);
  });

  it("PATCH: changing triggerSec to a free slot on an unlocked video works", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    const res = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { triggerSec: 20 }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).triggerSec).toBe(20);
  });

  it("PATCH: correctChoice must still be among the effective choices after the update", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_4, correctChoice: "D" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    // Removing D while it's still the correct choice must be rejected.
    const res = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { choices: CHOICES_2 }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE: removes an unlocked question; 409 VIDEO_LOCKED when the video has viewers", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    const deleted = await deleteQuestion(adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "DELETE", adminCookie: cookie }), paramsOf(q.id));
    expect(deleted.status).toBe(200);
    expect(await prisma.quizQuestion.findUnique({ where: { id: q.id } })).toBeNull();

    const q2 = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 15, prompt: "Q2?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    await lockVideo(cookie, video.id);
    const lockedDelete = await deleteQuestion(adminRequest(`http://t/api/admin/questions/${q2.id}`, { method: "DELETE", adminCookie: cookie }), paramsOf(q2.id));
    expect(lockedDelete.status).toBe(409);
    expect((await lockedDelete.json()).error.code).toBe("VIDEO_LOCKED");
  });

  it("PATCH/DELETE an unknown question id → 404 QUESTION_NOT_FOUND", async () => {
    const admin = await createTestAdmin();
    const cookie = await issueCookie(admin.id);
    const patchRes = await patchQuestion(
      adminRequest("http://t/api/admin/questions/does-not-exist", { method: "PATCH", body: { prompt: "x" }, adminCookie: cookie }),
      paramsOf("does-not-exist"),
    );
    expect(patchRes.status).toBe(404);
    expect((await patchRes.json()).error.code).toBe("QUESTION_NOT_FOUND");

    const deleteRes = await deleteQuestion(adminRequest("http://t/api/admin/questions/does-not-exist", { method: "DELETE", adminCookie: cookie }), paramsOf("does-not-exist"));
    expect(deleteRes.status).toBe(404);
  });
});

describe("review round 2 MINOR 2: duplicate choice labels are rejected by the schema, not the DB", () => {
  afterAll(() => prisma.$disconnect());

  it("create with two choices sharing a label → 400 VALIDATION_ERROR, not 409 DUPLICATE_TRIGGER", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const res = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, {
        body: { triggerSec: 10, prompt: "Q?", choices: [{ label: "A", text: "a" }, { label: "A", text: "a again" }], correctChoice: "A" },
        adminCookie: cookie,
      }),
      paramsOf(video.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("update with duplicate labels → 400 VALIDATION_ERROR", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const q = await (
      await createQuestion(
        adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
        paramsOf(video.id),
      )
    ).json();
    const res = await patchQuestion(
      adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { choices: [{ label: "A", text: "x" }, { label: "A", text: "y" }] }, adminCookie: cookie }),
      paramsOf(q.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("review round 2 MINOR 1: AdminAuditLog for question mutations", () => {
  afterAll(() => prisma.$disconnect());

  it("create/update/delete each write exactly one audit row", async () => {
    const { cookie, video } = await createUnlockedVideo(60);
    const createRes = await createQuestion(
      adminRequest(`http://t/api/admin/videos/${video.id}/questions`, { body: { triggerSec: 10, prompt: "Q?", choices: CHOICES_2, correctChoice: "A" }, adminCookie: cookie }),
      paramsOf(video.id),
    );
    const q = await createRes.json();

    await patchQuestion(adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "PATCH", body: { prompt: "Edited?" }, adminCookie: cookie }), paramsOf(q.id));
    await deleteQuestion(adminRequest(`http://t/api/admin/questions/${q.id}`, { method: "DELETE", adminCookie: cookie }), paramsOf(q.id));

    const rows = await prisma.adminAuditLog.findMany({ where: { entityId: q.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["question.create", "question.update", "question.delete"]);
    expect(rows.every((r) => r.entity === "question")).toBe(true);
  });
});
