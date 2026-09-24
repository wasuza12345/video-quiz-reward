import { prisma } from "@/backend/lib/prisma";
import type { AdminQuestionRow, CreateQuestionInput, PublicChoice, QuizRepository, UpdateQuestionInput } from "./quiz.interface";

function toAdminRow(q: { id: string; videoId: string; triggerSec: number; prompt: string; correctChoice: string; choices: { label: string; text: string }[] }): AdminQuestionRow {
  // Explicitly projected, not `choices: q.choices` — Prisma's `include` (no `select`) returns the
  // full QuizChoice row (questionId, label, text), which would otherwise leak questionId into the
  // API response since object-literal excess-property checks don't apply to a value passed through
  // a typed parameter.
  return { id: q.id, videoId: q.videoId, triggerSec: q.triggerSec, prompt: q.prompt, correctChoice: q.correctChoice, choices: q.choices.map((c) => ({ label: c.label, text: c.text })) };
}

async function loadAdminRow(id: string): Promise<AdminQuestionRow | null> {
  const q = await prisma.quizQuestion.findUnique({ where: { id }, include: { choices: { orderBy: { label: "asc" } } } });
  return q ? toAdminRow(q) : null;
}

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

    findAdminById: loadAdminRow,

    async create(input: CreateQuestionInput) {
      const q = await prisma.quizQuestion.create({
        data: {
          videoId: input.videoId,
          triggerSec: input.triggerSec,
          prompt: input.prompt,
          correctChoice: input.correctChoice,
          choices: { create: input.choices.map((c) => ({ label: c.label, text: c.text })) },
        },
        include: { choices: { orderBy: { label: "asc" } } },
      });
      return toAdminRow(q);
    },

    async update(id, input: UpdateQuestionInput) {
      const scalarChanges: { triggerSec?: number; prompt?: string; correctChoice?: string } = {};
      if (input.triggerSec !== undefined) scalarChanges.triggerSec = input.triggerSec;
      if (input.prompt !== undefined) scalarChanges.prompt = input.prompt;
      if (input.correctChoice !== undefined) scalarChanges.correctChoice = input.correctChoice;
      if (Object.keys(scalarChanges).length > 0) {
        await prisma.quizQuestion.update({ where: { id }, data: scalarChanges });
      }

      if (input.choices) {
        const current = await prisma.quizChoice.findMany({ where: { questionId: id }, select: { label: true } });
        const currentLabels = new Set(current.map((c) => c.label));
        const nextLabels = new Set(input.choices.map((c) => c.label));
        const toDelete = [...currentLabels].filter((l) => !nextLabels.has(l));

        const ops = [
          ...toDelete.map((label) => prisma.quizChoice.delete({ where: { questionId_label: { questionId: id, label } } })),
          ...input.choices.map((c: PublicChoice) =>
            prisma.quizChoice.upsert({
              where: { questionId_label: { questionId: id, label: c.label } },
              create: { questionId: id, label: c.label, text: c.text },
              update: { text: c.text },
            }),
          ),
        ];
        if (ops.length > 0) await prisma.$transaction(ops);
      }

      const row = await loadAdminRow(id);
      if (!row) throw new Error(`quiz question ${id} vanished during update`);
      return row;
    },

    async delete(id) {
      await prisma.quizQuestion.delete({ where: { id } });
    },
  };
}
