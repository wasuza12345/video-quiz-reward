import "dotenv/config";
import { z } from "zod";
import { prisma } from "../src/backend/lib/prisma";
import { hashPassword } from "../src/backend/lib/password";

// Idempotent: every write is an upsert keyed on a unique column, and existing rows
// are never overwritten (an admin may have edited them since the first seed).

const seedEnv = z
  .object({
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters"),
  })
  .parse(process.env);

const BRIEF_VIDEO = {
  youtubeId: "X7K_Xlz3T1Y",
  title: "ตัวอย่างคลิป - 50 เรื่องลี้ลับ เก่งศัพท์ อ่านคล่อง",
  channelName: "ครูหวาน: English On Air",
  durationSec: 44,
  rewardPoints: 50,
};

const BRIEF_QUESTION = {
  triggerSec: 13,
  prompt: "Where does the flower bloom?",
  correctChoice: "D",
  choices: [
    { label: "A", text: "Beside the river below the waterfall" },
    { label: "B", text: "Behind the waterfall's stream" },
    { label: "C", text: "Behind the waterfall" },
    { label: "D", text: "Behind the waterfall's flowing water" },
  ],
};

async function seedAdmin() {
  const email = seedEnv.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.admin.create({
    data: { email, passwordHash: await hashPassword(seedEnv.ADMIN_PASSWORD) },
  });
}

async function seedBriefVideo() {
  const existing = await prisma.video.findUnique({ where: { youtubeId: BRIEF_VIDEO.youtubeId } });
  if (existing) return existing;
  // At most one featured video.
  await prisma.video.updateMany({ where: { isFeatured: true }, data: { isFeatured: false } });
  return prisma.video.create({
    data: { ...BRIEF_VIDEO, status: "published", isFeatured: true, publishedAt: new Date() },
  });
}

async function seedBriefQuiz(videoId: string) {
  const { choices, ...question } = BRIEF_QUESTION;
  const q = await prisma.quizQuestion.upsert({
    where: { videoId_triggerSec: { videoId, triggerSec: question.triggerSec } },
    create: { ...question, videoId },
    update: {},
  });
  for (const choice of choices) {
    await prisma.quizChoice.upsert({
      where: { questionId_label: { questionId: q.id, label: choice.label } },
      create: { ...choice, questionId: q.id },
      update: {},
    });
  }
  return q;
}

async function main() {
  const admin = await seedAdmin();
  const video = await seedBriefVideo();
  await seedBriefQuiz(video.id);
  console.log(`seed ok: admin=${admin.email} video=${video.youtubeId}`);
}

main()
  .catch((err) => {
    console.error(err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
