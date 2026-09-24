import { afterAll, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/me/route";
import { GET as getVideos } from "@/app/api/videos/route";
import { prisma } from "@/backend/lib/prisma";
import { authedRequest, createTestVideo, newUserId } from "./helpers";

describe("GET /api/me", () => {
  afterAll(() => prisma.$disconnect());

  it("an unknown user has 0 points and no rewarded videos", async () => {
    const res = await getMe(authedRequest("http://t/api/me", { userId: newUserId() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ totalPoints: 0, rewardedVideoIds: [] });
  });
});

describe("GET /api/videos", () => {
  it("lists published videos, marks the featured one, excludes draft/archived", async () => {
    const featured = await createTestVideo({ isFeatured: true, title: "Featured" });
    const other = await createTestVideo({ title: "Other" });
    await createTestVideo({ status: "draft", title: "Draft" });
    await createTestVideo({ status: "archived", title: "Archived" });

    const res = await getVideos(authedRequest("http://t/api/videos", { userId: newUserId() }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.featured).toMatchObject({ id: featured.id, title: "Featured", rewarded: false });
    const ids = body.videos.map((v: { id: string }) => v.id);
    expect(ids).toContain(featured.id);
    expect(ids).toContain(other.id);
    expect(body.videos.find((v: { id: string }) => v.id === other.id)).toMatchObject({ questionCount: 0, rewarded: false });
  });
});
