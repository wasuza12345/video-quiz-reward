// Extra short-lived published videos for the anti-cheat / replay E2E specs (plan §10 early P6
// slice) — no quiz questions, so canEnd only needs furthestSec/playedWallSec. Idempotent upserts,
// run once per e2e server boot (scripts/e2e-server.sh) after the real prisma/seed.ts.
import { prisma } from "../../../src/backend/lib/prisma";
import { CHEATS_VIDEO_DURATION_SEC, CHEATS_VIDEO_YOUTUBE_ID, REPLAY_VIDEO_DURATION_SEC, REPLAY_VIDEO_YOUTUBE_ID } from "../helpers/env";

async function upsertVideo(input: { youtubeId: string; title: string; durationSec: number }) {
  const existing = await prisma.video.findUnique({ where: { youtubeId: input.youtubeId } });
  if (existing) return existing;
  return prisma.video.create({
    data: {
      youtubeId: input.youtubeId,
      title: input.title,
      channelName: "E2E Fixtures",
      durationSec: input.durationSec,
      rewardPoints: 50,
      status: "published",
      isFeatured: false,
      publishedAt: new Date(),
    },
  });
}

async function main() {
  await upsertVideo({ youtubeId: CHEATS_VIDEO_YOUTUBE_ID, title: "E2E cheats fixture", durationSec: CHEATS_VIDEO_DURATION_SEC });
  await upsertVideo({ youtubeId: REPLAY_VIDEO_YOUTUBE_ID, title: "E2E replay fixture", durationSec: REPLAY_VIDEO_DURATION_SEC });
  console.log("e2e extra fixtures ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
