import { randomUUID } from "node:crypto";
import { prisma } from "@/backend/lib/prisma";
import { auditLogEntry } from "@/backend/common/audit/audit-log";
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

    async create(input: CreateQuestionInput, audit) {
      const id = randomUUID(); // generated client-side so the audit row can reference it in the same transaction
      const [q] = await prisma.$transaction([
        prisma.quizQuestion.create({
          data: {
            id,
            videoId: input.videoId,
            triggerSec: input.triggerSec,
            prompt: input.prompt,
            correctChoice: input.correctChoice,
            choices: { create: input.choices.map((c) => ({ label: c.label, text: c.text })) },
          },
          include: { choices: { orderBy: { label: "asc" } } },
        }),
        auditLogEntry(audit, "question.create", "question", id, input),
      ]);
      return toAdminRow(q);
    },

    async update(id, input: UpdateQuestionInput, audit, requireUnlocked) {
      // One interactive transaction (review round 3): the lock gate, the scalar update, the
      // choice diff and the audit row all commit — or none do. Interactive transactions are
      // avoided elsewhere in this codebase (plan §9, the viewer hot path against Turso), but this
      // is a rare admin write where SQLite's write-lock serializing it against a concurrent
      // session INSERT is an acceptable, explicitly reviewed trade-off.
      return prisma.$transaction(async (tx) => {
        if (requireUnlocked) {
          // `data: {}` (a genuinely empty SET clause) silently matches 0 rows regardless of
          // `where` — confirmed against the real driver — so this touches a real, harmless field instead.
          const gate = await tx.quizQuestion.updateMany({ where: { id, video: { sessions: { none: {} } } }, data: { triggerSec: { increment: 0 } } });
          if (gate.count === 0) return null;
        }

        const scalarChanges: { triggerSec?: number; prompt?: string; correctChoice?: string } = {};
        if (input.triggerSec !== undefined) scalarChanges.triggerSec = input.triggerSec;
        if (input.prompt !== undefined) scalarChanges.prompt = input.prompt;
        if (input.correctChoice !== undefined) scalarChanges.correctChoice = input.correctChoice;
        if (Object.keys(scalarChanges).length > 0) await tx.quizQuestion.update({ where: { id }, data: scalarChanges });

        if (input.choices) {
          const current = await tx.quizChoice.findMany({ where: { questionId: id }, select: { label: true } });
          const currentLabels = new Set(current.map((c) => c.label));
          const nextLabels = new Set(input.choices.map((c) => c.label));
          const toDelete = [...currentLabels].filter((l) => !nextLabels.has(l));
          for (const label of toDelete) await tx.quizChoice.delete({ where: { questionId_label: { questionId: id, label } } });
          for (const c of input.choices as PublicChoice[]) {
            await tx.quizChoice.upsert({
              where: { questionId_label: { questionId: id, label: c.label } },
              create: { questionId: id, label: c.label, text: c.text },
              update: { text: c.text },
            });
          }
        }

        await tx.adminAuditLog.create({ data: { adminId: audit.adminId, action: "question.update", entity: "question", entityId: id, diff: JSON.stringify(input) } });

        const q = await tx.quizQuestion.findUnique({ where: { id }, include: { choices: { orderBy: { label: "asc" } } } });
        if (!q) throw new Error(`quiz question ${id} vanished during update`);
        return toAdminRow(q);
      });
    },

    async delete(id, audit) {
      // Interactive transaction (review round 3) so the delete and its audit row are atomic —
      // see the comment on `update` above for why this is an accepted exception to plan §9.
      return prisma.$transaction(async (tx) => {
        const result = await tx.quizQuestion.deleteMany({ where: { id, video: { sessions: { none: {} } } } });
        if (result.count === 0) return false;
        await tx.adminAuditLog.create({ data: { adminId: audit.adminId, action: "question.delete", entity: "question", entityId: id, diff: null } });
        return true;
      });
    },
  };
}
