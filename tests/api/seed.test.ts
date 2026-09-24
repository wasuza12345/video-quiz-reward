import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/backend/lib/prisma";

// Runs against the migrated + seeded DB from DATABASE_URL, through the libsql adapter client.
describe("seeded brief video", () => {
  afterAll(() => prisma.$disconnect());

  it("is published, featured and has its quiz at 0:13", async () => {
    const video = await prisma.video.findUnique({
      where: { youtubeId: "X7K_Xlz3T1Y" },
      include: { questions: { include: { choices: { orderBy: { label: "asc" } } } } },
    });

    expect(video).toMatchObject({
      durationSec: 44,
      rewardPoints: 50,
      status: "published",
      isFeatured: true,
    });
    expect(video!.questions).toHaveLength(1);
    const [question] = video!.questions;
    expect(question).toMatchObject({ triggerSec: 13, prompt: "Where does the flower bloom?", correctChoice: "D" });
    expect(question.choices.map((c) => c.label)).toEqual(["A", "B", "C", "D"]);
  });
});
