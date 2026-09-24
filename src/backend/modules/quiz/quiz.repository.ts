import { prisma } from "@/backend/lib/prisma";
import type { QuizRepository } from "./quiz.interface";

export function createQuizRepository(): QuizRepository {
  return {
    async listForVideo(videoId) {
      const questions = await prisma.quizQuestion.findMany({
        where: { videoId },
        orderBy: { triggerSec: "asc" },
        include: { choices: { orderBy: { label: "asc" } } },
      });
      return questions.map((q) => ({
        id: q.id,
        triggerSec: q.triggerSec,
        prompt: q.prompt,
        choices: q.choices.map((c) => ({ label: c.label, text: c.text })),
      }));
    },

    async findForAnswer(questionId) {
      const q = await prisma.quizQuestion.findUnique({
        where: { id: questionId },
        include: { choices: { select: { label: true } } },
      });
      if (!q) return null;
      return { id: q.id, videoId: q.videoId, correctChoice: q.correctChoice, labels: q.choices.map((c) => c.label) };
    },
  };
}
