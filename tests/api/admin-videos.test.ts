import { afterAll, describe, expect, it, vi } from "vitest";
import { GET as getVideo, PATCH as patchVideo } from "@/app/api/admin/videos/[id]/route";
import { POST as archiveVideo } from "@/app/api/admin/videos/[id]/archive/route";
import { POST as featureVideo } from "@/app/api/admin/videos/[id]/feature/route";
import { POST as publishVideo } from "@/app/api/admin/videos/[id]/publish/route";
import { GET as listVideos, POST as createVideo } from "@/app/api/admin/videos/route";
import { POST as createQuestion } from "@/app/api/admin/videos/[id]/questions/route";
import { POST as postSessions } from "@/app/api/sessions/route";
import { prisma } from "@/backend/lib/prisma";
import { adminRequest, createTestAdmin, newUserId, paramsOf, postJson } from "./helpers";

vi.mock("@/backend/lib/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/lib/youtube")>();
  return {
    ...actual,
    fetchYoutubeOembed: vi.fn(async (youtubeId: string) => {
      if (youtubeId === "notembeddab") return null;
      return { title: `oEmbed title for ${youtubeId}`, channelName: `Channel ${youtubeId}` };
    }),
  };
});

async function loggedInAdmin() {
  return createTestAdmin();
}

/** A fresh, always-unique 11-char id (real YouTube ids are 11 chars) — youtubeId is `@unique` in
 * the schema and this file's DB rows persist across repeated local `vitest run`s (this suite,
 * like the rest of tests/api/**, never resets the DB — see helpers.ts), so a fixed literal here
 * would collide with a leftover row from an earlier run. */
function randomYoutubeId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 11 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** setFeatured() enforces "at most one featured video" globally (plan §4.4), so ANY test that
 * features a video necessarily de-features whatever else was featured beforehand — including, if
 * the DB has never been reset since seeding, the seeded brief video that tests/api/seed.test.ts
 * asserts stays featured. Every test that calls the feature endpoint must snapshot + restore
 * (this repo's rule: a test that mutates shared DB state must always restore it). */
async function withFeaturedSnapshotRestored<T>(cookie: string, run: () => Promise<T>): Promise<T> {
  const previouslyFeatured = await prisma.video.findFirst({ where: { isFeatured: true } });
  try {
    return await run();
  } finally {
    if (previouslyFeatured) await featureVideo(adminRequest(`${VIDEOS_URL}/${previouslyFeatured.id}/feature`, { adminCookie: cookie }), paramsOf(previouslyFeatured.id));
  }
}

/** admin-auth.test.ts already proves the real login flow end to end; these tests only need a
 * valid session, so they mint the JWT directly rather than paying for a bcrypt round trip each time. */
async function issueCookie(adminId: string) {
  const { issueAdminCookieValue } = await import("@/backend/common/auth/admin-session");
  return issueAdminCookieValue({ adminId, tokenVersion: 0 });
}

const VIDEOS_URL = "http://t/api/admin/videos";

describe("admin video CRUD (plan §4.4/§4.5/§7)", () => {
  afterAll(() => prisma.$disconnect());

  it("creates a video: parses the URL, fetches oEmbed for channelName, defaults title from oEmbed when omitted", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const youtubeId = randomYoutubeId();

    const res = await createVideo(
      adminRequest(VIDEOS_URL, { body: { youtubeUrl: `https://youtu.be/${youtubeId}`, durationSec: 44, rewardPoints: 50 }, adminCookie: cookie }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      youtubeId,
      title: `oEmbed title for ${youtubeId}`,
      channelName: `Channel ${youtubeId}`,
      status: "draft",
      isFeatured: false,
      questionCount: 0,
      sessionCount: 0,
      locked: false,
    });
  });

  it("uses the given title instead of oEmbed's when provided", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const res = await createVideo(
      adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), title: "My Own Title", durationSec: 30, rewardPoints: 10 }, adminCookie: cookie }),
    );
    expect((await res.json()).title).toBe("My Own Title");
  });

  it("invalid YouTube URL → 400 VALIDATION_ERROR", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const res = await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: "not a url", durationSec: 30, rewardPoints: 10 }, adminCookie: cookie }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("not embeddable (oEmbed fails) → 400 VALIDATION_ERROR", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const res = await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: "notembeddab", durationSec: 30, rewardPoints: 10 }, adminCookie: cookie }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("duplicate youtubeId → 400 VALIDATION_ERROR, with an issues[].message the admin UI can tell apart from a plain invalid link", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const body = { youtubeUrl: randomYoutubeId(), durationSec: 30, rewardPoints: 10 };
    const first = await createVideo(adminRequest(VIDEOS_URL, { body, adminCookie: cookie }));
    expect(first.status).toBe(200);
    const second = await createVideo(adminRequest(VIDEOS_URL, { body, adminCookie: cookie }));
    expect(second.status).toBe(400);
    const secondBody = await second.json();
    expect(secondBody.error.code).toBe("VALIDATION_ERROR");
    // AdminVideoFormPage's youtubeUrlIssueMessage keys off this exact string to show a
    // "already added" copy instead of the generic invalid-link one (tester audit MINOR 1).
    expect(secondBody.error.issues).toEqual([{ path: "youtubeUrl", message: "already added" }]);
  });

  it("rewardPoints out of the 1-1000 range → 400 VALIDATION_ERROR", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const res = await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 30, rewardPoints: 0 }, adminCookie: cookie }));
    expect(res.status).toBe(400);
  });

  it("missing/mismatched Origin → 403 BAD_ORIGIN", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const res = await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 30, rewardPoints: 10 }, adminCookie: cookie, origin: null }));
    expect(res.status).toBe(403);
  });

  it("lists videos with paging", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 30, rewardPoints: 10 }, adminCookie: cookie }));
    const res = await listVideos(adminRequest(`${VIDEOS_URL}?page=1&pageSize=5`, { method: "GET", adminCookie: cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(5);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
  });

  it("GET detail: 404 VIDEO_NOT_FOUND for an unknown id", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const res = await getVideo(adminRequest("http://t/api/admin/videos/does-not-exist", { method: "GET", adminCookie: cookie }), paramsOf("does-not-exist"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("VIDEO_NOT_FOUND");
  });

  it("GET detail includes questions", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    await prisma.quizQuestion.create({
      data: { videoId: created.id, triggerSec: 10, prompt: "Q?", correctChoice: "A", choices: { create: [{ label: "A", text: "a" }, { label: "B", text: "b" }] } },
    });
    const res = await getVideo(adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "GET", adminCookie: cookie }), paramsOf(created.id));
    const body = await res.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]).toMatchObject({ triggerSec: 10, prompt: "Q?", correctChoice: "A" });
  });

  it("PATCH: title and rewardPoints are editable on an unlocked video", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const res = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { title: "New Title", rewardPoints: 99 }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("New Title");
    expect(body.rewardPoints).toBe(99);
  });

  it("PATCH: youtubeUrl is editable on an unlocked video and re-fetches channelName", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const newYoutubeId = randomYoutubeId();
    const res = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { youtubeUrl: `https://youtu.be/${newYoutubeId}` }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.youtubeId).toBe(newYoutubeId);
    expect(body.channelName).toBe(`Channel ${newYoutubeId}`);
  });

  it("PATCH on a LOCKED video: youtubeUrl/durationSec → 409 VIDEO_LOCKED; title/rewardPoints still succeed", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
    // A real WatchSession is what locks a video (plan §7: "once a video has any WatchSession").
    await postSessions(postJson("http://t/api/sessions", { videoId: created.id }, { userId: newUserId() }));

    const lockedDuration = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { durationSec: 99 }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(lockedDuration.status).toBe(409);
    expect((await lockedDuration.json()).error.code).toBe("VIDEO_LOCKED");

    const lockedUrl = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { youtubeUrl: "https://youtu.be/wontgothrough" }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(lockedUrl.status).toBe(409);

    const stillEditable = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { title: "Still editable", rewardPoints: 77 }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(stillEditable.status).toBe(200);
    expect((await stillEditable.json()).title).toBe("Still editable");
  });

  it("publish: draft → published, sets publishedAt", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const res = await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
    const body = await res.json();
    expect(body.status).toBe("published");
    expect(body.publishedAt).toBeTruthy();
  });

  it("archive: any status → archived", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const res = await archiveVideo(adminRequest(`${VIDEOS_URL}/${created.id}/archive`, { adminCookie: cookie }), paramsOf(created.id));
    expect((await res.json()).status).toBe("archived");
  });

  it("feature: sets isFeatured and unsets any previously featured video", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    await withFeaturedSnapshotRestored(cookie, async () => {
      const a = await (
        await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
      ).json();
      const b = await (
        await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
      ).json();
      // Only a published video can be featured.
      await publishVideo(adminRequest(`${VIDEOS_URL}/${a.id}/publish`, { adminCookie: cookie }), paramsOf(a.id));
      await publishVideo(adminRequest(`${VIDEOS_URL}/${b.id}/publish`, { adminCookie: cookie }), paramsOf(b.id));

      const first = await featureVideo(adminRequest(`${VIDEOS_URL}/${a.id}/feature`, { adminCookie: cookie }), paramsOf(a.id));
      expect((await first.json()).isFeatured).toBe(true);

      const second = await featureVideo(adminRequest(`${VIDEOS_URL}/${b.id}/feature`, { adminCookie: cookie }), paramsOf(b.id));
      expect((await second.json()).isFeatured).toBe(true);

      const aAfter = await getVideo(adminRequest(`${VIDEOS_URL}/${a.id}`, { method: "GET", adminCookie: cookie }), paramsOf(a.id));
      expect((await aAfter.json()).isFeatured).toBe(false);
    });
  });
});

describe("shortening durationSec must not strand an existing question", () => {
  afterAll(() => prisma.$disconnect());

  it("PATCH durationSec that pushes an existing question's trigger past the new gate window → 422 INVALID_TRIGGER, and the video is left unchanged", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 60, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    // triggerSec 50 fits a 60s video (50 < 60-2=58) but not a 52s one (50 is not < 52-2=50).
    await createQuestion(
      adminRequest(`http://t/api/admin/videos/${created.id}/questions`, {
        body: { triggerSec: 50, prompt: "Q?", choices: [{ label: "A", text: "a" }, { label: "B", text: "b" }], correctChoice: "A" },
        adminCookie: cookie,
      }),
      paramsOf(created.id),
    );

    const res = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { durationSec: 52 }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_TRIGGER");

    const stillOriginal = await getVideo(adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "GET", adminCookie: cookie }), paramsOf(created.id));
    expect((await stillOriginal.json()).durationSec).toBe(60);
  });

  it("PATCH durationSec that every question still fits within → 200", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 60, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    await createQuestion(
      adminRequest(`http://t/api/admin/videos/${created.id}/questions`, {
        body: { triggerSec: 10, prompt: "Q?", choices: [{ label: "A", text: "a" }, { label: "B", text: "b" }], correctChoice: "A" },
        adminCookie: cookie,
      }),
      paramsOf(created.id),
    );

    const res = await patchVideo(
      adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { durationSec: 30 }, adminCookie: cookie }),
      paramsOf(created.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).durationSec).toBe(30);
  });
});

describe("publish re-validates every question", () => {
  afterAll(() => prisma.$disconnect());

  it("publishing a video whose question no longer fits its duration → 422 INVALID_TRIGGER, stays draft", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 60, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    await createQuestion(
      adminRequest(`http://t/api/admin/videos/${created.id}/questions`, {
        body: { triggerSec: 50, prompt: "Q?", choices: [{ label: "A", text: "a" }, { label: "B", text: "b" }], correctChoice: "A" },
        adminCookie: cookie,
      }),
      paramsOf(created.id),
    );
    // Directly corrupt the stored question's triggerSec to simulate one that predates a duration
    // shortcut the PATCH guard would otherwise have caught — publish is the last line of defense.
    await prisma.quizQuestion.updateMany({ where: { videoId: created.id }, data: { triggerSec: 59 } });

    const res = await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_TRIGGER");

    const stillDraft = await getVideo(adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "GET", adminCookie: cookie }), paramsOf(created.id));
    expect((await stillDraft.json()).status).toBe("draft");
  });

  it("publishing a video with 0 questions is allowed (plan §4.5)", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 60, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const res = await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
    expect(res.status).toBe(200);
  });
});

describe("status transition rules", () => {
  afterAll(() => prisma.$disconnect());

  it("feature on a non-published (draft) video → 409 INVALID_TRANSITION", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const res = await featureVideo(adminRequest(`${VIDEOS_URL}/${created.id}/feature`, { adminCookie: cookie }), paramsOf(created.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("INVALID_TRANSITION");
  });

  it("publishing an already-published video is a no-op (documented choice) — 200, unchanged", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const created = await (
      await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
    ).json();
    const first = await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
    const firstBody = await first.json();
    const second = await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
    expect(second.status).toBe(200);
    expect((await second.json()).publishedAt).toBe(firstBody.publishedAt);
  });

  it("archiving a featured video also clears isFeatured", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    await withFeaturedSnapshotRestored(cookie, async () => {
      const created = await (
        await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
      ).json();
      await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
      await featureVideo(adminRequest(`${VIDEOS_URL}/${created.id}/feature`, { adminCookie: cookie }), paramsOf(created.id));

      const res = await archiveVideo(adminRequest(`${VIDEOS_URL}/${created.id}/archive`, { adminCookie: cookie }), paramsOf(created.id));
      const body = await res.json();
      expect(body.status).toBe("archived");
      expect(body.isFeatured).toBe(false);
    });
  });
});

describe("AdminAuditLog", () => {
  afterAll(() => prisma.$disconnect());

  it("one mutation writes exactly one audit row, with the acting admin, action, entity and entityId", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    const youtubeId = randomYoutubeId();
    const before = await prisma.adminAuditLog.count({ where: { action: "video.create" } });

    const res = await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: youtubeId, durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }));
    const created = await res.json();

    const after = await prisma.adminAuditLog.count({ where: { action: "video.create" } });
    expect(after).toBe(before + 1);

    const row = await prisma.adminAuditLog.findFirst({ where: { action: "video.create", entityId: created.id } });
    expect(row).toMatchObject({ adminId: admin.id, action: "video.create", entity: "video", entityId: created.id });
    expect(JSON.parse(row!.diff!)).toMatchObject({ youtubeId, durationSec: 40, rewardPoints: 10 });
  });

  it("publish/archive/feature/update each write their own audit row", async () => {
    const admin = await loggedInAdmin();
    const cookie = await issueCookie(admin.id);
    await withFeaturedSnapshotRestored(cookie, async () => {
      const created = await (
        await createVideo(adminRequest(VIDEOS_URL, { body: { youtubeUrl: randomYoutubeId(), durationSec: 40, rewardPoints: 10 }, adminCookie: cookie }))
      ).json();

      await patchVideo(adminRequest(`${VIDEOS_URL}/${created.id}`, { method: "PATCH", body: { title: "Audited Title" }, adminCookie: cookie }), paramsOf(created.id));
      await publishVideo(adminRequest(`${VIDEOS_URL}/${created.id}/publish`, { adminCookie: cookie }), paramsOf(created.id));
      await featureVideo(adminRequest(`${VIDEOS_URL}/${created.id}/feature`, { adminCookie: cookie }), paramsOf(created.id));
      await archiveVideo(adminRequest(`${VIDEOS_URL}/${created.id}/archive`, { adminCookie: cookie }), paramsOf(created.id));

      const rows = await prisma.adminAuditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => r.action)).toEqual(["video.create", "video.update", "video.publish", "video.feature", "video.archive"]);
      expect(rows.every((r) => r.adminId === admin.id)).toBe(true);
    });
  });
});
