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
      if (requireUnlocked) {
        // A probe ahead of the real batch below, not folded into it: Prisma's non-interactive
        // `$transaction([...])` array form runs every element unconditionally (an `updateMany`
        // matching 0 rows doesn't abort its siblings), so the choice deletes/upserts further down
        // can't be made conditional on this same check within one call (review round 2 MINOR 3).
        // `data: {}` (a genuinely empty SET clause) silently matches 0 rows regardless of `where`
        // — confirmed against the real driver — so the probe uses a real, semantically-harmless
        // write (+0) instead.
        const gate = await prisma.quizQuestion.updateMany({ where: { id, video: { sessions: { none: {} } } }, data: { triggerSec: { increment: 0 } } });
        if (gate.count === 0) return null;
      }

      const scalarChanges: { triggerSec?: number; prompt?: string; correctChoice?: string } = {};
      if (input.triggerSec !== undefined) scalarChanges.triggerSec = input.triggerSec;
      if (input.prompt !== undefined) scalarChanges.prompt = input.prompt;
      if (input.correctChoice !== undefined) scalarChanges.correctChoice = input.correctChoice;

      // Scalar fields + the choice diff + the audit row, batched in one transaction (review round
      // 2 MINOR 6) rather than as separate sequential calls.
      const ops = [];
      if (Object.keys(scalarChanges).length > 0) ops.push(prisma.quizQuestion.update({ where: { id }, data: scalarChanges }));
      if (input.choices) {
        const current = await prisma.quizChoice.findMany({ where: { questionId: id }, select: { label: true } });
        const currentLabels = new Set(current.map((c) => c.label));
        const nextLabels = new Set(input.choices.map((c) => c.label));
        const toDelete = [...currentLabels].filter((l) => !nextLabels.has(l));
        ops.push(
          ...toDelete.map((label) => prisma.quizChoice.delete({ where: { questionId_label: { questionId: id, label } } })),
          ...input.choices.map((c: PublicChoice) =>
            prisma.quizChoice.upsert({
              where: { questionId_label: { questionId: id, label: c.label } },
              create: { questionId: id, label: c.label, text: c.text },
              update: { text: c.text },
            }),
          ),
        );
      }
      ops.push(auditLogEntry(audit, "question.update", "question", id, input));
      await prisma.$transaction(ops);

      const row = await loadAdminRow(id);
      if (!row) throw new Error(`quiz question ${id} vanished during update`);
      return row;
    },

    async delete(id, audit) {
      // The delete itself is the atomic conditional check (review round 2 MINOR 3) — unlike
      // update, delete has no "always allowed" subset of fields, so there's nothing it could
      // partially apply; count 0 means locked (or already gone).
      const result = await prisma.quizQuestion.deleteMany({ where: { id, video: { sessions: { none: {} } } } });
      if (result.count === 0) return false;
      // Not batched with the deleteMany above — that already committed by the time we know it
      // succeeded, so there is nothing left to make atomic with it.
      await auditLogEntry(audit, "question.delete", "question", id, {});
      return true;
    },
  };
}
