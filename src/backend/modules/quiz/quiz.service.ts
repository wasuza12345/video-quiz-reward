import { Prisma } from "@/backend/lib/prisma";
import { AppError } from "@/backend/common/errors/app-error";
import type { AdminCreateQuestionBody, AdminQuestionDetail, AdminUpdateQuestionBody } from "@/shared/contracts/admin";
import type { VideoRepository } from "../video/video.interface";
import type { AdminQuestionRow, QuizRepository } from "./quiz.interface";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function toDetail(row: AdminQuestionRow): AdminQuestionDetail {
  return { id: row.id, triggerSec: row.triggerSec, prompt: row.prompt, correctChoice: row.correctChoice, choices: row.choices };
}

/** 0 < triggerSec < durationSec - 2 (plan §7). */
function assertValidTrigger(triggerSec: number, durationSec: number): void {
  if (triggerSec > 0 && triggerSec < durationSec - 2) return;
  throw new AppError("INVALID_TRIGGER", `trigger must be between 0:00 and ${(durationSec - 2).toFixed(1)}s`, { durationSec });
}

function assertCorrectChoiceAmongLabels(correctChoice: string, labels: string[]): void {
  if (labels.includes(correctChoice)) return;
  throw new AppError("VALIDATION_ERROR", "correctChoice must be one of the provided choices", {
    issues: [{ path: "correctChoice", message: "must be one of the provided choices" }],
  });
}

export interface AdminQuestionService {
  create(videoId: string, input: AdminCreateQuestionBody): Promise<AdminQuestionDetail>;
  update(questionId: string, input: AdminUpdateQuestionBody): Promise<AdminQuestionDetail>;
  delete(questionId: string): Promise<void>;
}

export function createAdminQuestionService(deps: { quizRepo: QuizRepository; videoRepo: VideoRepository }): AdminQuestionService {
  return {
    async create(videoId, input) {
      const video = await deps.videoRepo.findAdminById(videoId);
      if (!video) throw new AppError("VIDEO_NOT_FOUND", "video not found");
      if (video.sessionCount > 0) {
        throw new AppError("VIDEO_LOCKED", "this video has viewers and no questions can be added", { sessionCount: video.sessionCount });
      }

      assertValidTrigger(input.triggerSec, video.durationSec);
      assertCorrectChoiceAmongLabels(
        input.correctChoice,
        input.choices.map((c) => c.label),
      );

      try {
        const row = await deps.quizRepo.create({ videoId, ...input });
        return toDetail(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("DUPLICATE_TRIGGER", "this video already has a question at that time", { issues: [{ path: "triggerSec", message: "duplicate trigger" }] });
        }
        throw err;
      }
    },

    async update(questionId, input) {
      const current = await deps.quizRepo.findAdminById(questionId);
      if (!current) throw new AppError("QUESTION_NOT_FOUND", "question not found");
      const video = await deps.videoRepo.findAdminById(current.videoId);
      if (!video) throw new AppError("VIDEO_NOT_FOUND", "video not found");

      const locked = video.sessionCount > 0;
      if (locked) {
        if (input.triggerSec !== undefined && input.triggerSec !== current.triggerSec) {
          throw new AppError("VIDEO_LOCKED", "this video has viewers and its question times can no longer be changed", { sessionCount: video.sessionCount });
        }
        if (input.correctChoice !== undefined && input.correctChoice !== current.correctChoice) {
          throw new AppError("VIDEO_LOCKED", "this video has viewers and the correct answer can no longer be changed", { sessionCount: video.sessionCount });
        }
        if (input.choices !== undefined) {
          const currentLabels = new Set(current.choices.map((c) => c.label));
          const nextLabels = new Set<string>(input.choices.map((c) => c.label));
          const sameSet = currentLabels.size === nextLabels.size && [...currentLabels].every((l) => nextLabels.has(l));
          if (!sameSet) {
            throw new AppError("VIDEO_LOCKED", "this video has viewers and choices can no longer be added or removed", { sessionCount: video.sessionCount });
          }
        }
      }

      if (input.triggerSec !== undefined) assertValidTrigger(input.triggerSec, video.durationSec);

      if (input.correctChoice !== undefined || input.choices !== undefined) {
        const effectiveLabels = (input.choices ?? current.choices).map((c) => c.label);
        assertCorrectChoiceAmongLabels(input.correctChoice ?? current.correctChoice, effectiveLabels);
      }

      try {
        const row = await deps.quizRepo.update(questionId, input);
        return toDetail(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError("DUPLICATE_TRIGGER", "this video already has a question at that time", { issues: [{ path: "triggerSec", message: "duplicate trigger" }] });
        }
        throw err;
      }
    },

    async delete(questionId) {
      const current = await deps.quizRepo.findAdminById(questionId);
      if (!current) throw new AppError("QUESTION_NOT_FOUND", "question not found");
      const video = await deps.videoRepo.findAdminById(current.videoId);
      if (!video) throw new AppError("VIDEO_NOT_FOUND", "video not found");
      if (video.sessionCount > 0) {
        throw new AppError("VIDEO_LOCKED", "this video has viewers and questions can no longer be deleted", { sessionCount: video.sessionCount });
      }
      await deps.quizRepo.delete(questionId);
    },
  };
}
