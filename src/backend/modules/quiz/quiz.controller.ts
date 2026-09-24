import type { NextRequest } from "next/server";
import { AppError } from "@/backend/common/errors/app-error";
import { checkOrigin } from "@/backend/common/auth/origin-check";
import { requireAdmin } from "@/backend/common/auth/require-admin";
import { readJsonBody } from "@/backend/common/http/body-limit";
import { ok } from "@/backend/common/http/response";
import { parseBody } from "@/backend/common/validation/validate";
import { adminCreateQuestionBodySchema, adminUpdateQuestionBodySchema } from "@/shared/contracts/admin";
import type { AdminQuestionService } from "./quiz.service";

function requireOrigin(request: NextRequest): void {
  if (!checkOrigin(request)) throw new AppError("BAD_ORIGIN", "origin does not match host");
}

export function createAdminQuestionController(deps: { questionService: AdminQuestionService }) {
  return {
    async create(request: NextRequest, videoId: string) {
      await requireAdmin(request);
      requireOrigin(request);
      const body = parseBody(adminCreateQuestionBodySchema, await readJsonBody(request));
      return ok(await deps.questionService.create(videoId, body));
    },

    async update(request: NextRequest, questionId: string) {
      await requireAdmin(request);
      requireOrigin(request);
      const body = parseBody(adminUpdateQuestionBodySchema, await readJsonBody(request));
      return ok(await deps.questionService.update(questionId, body));
    },

    async remove(request: NextRequest, questionId: string) {
      await requireAdmin(request);
      requireOrigin(request);
      await deps.questionService.delete(questionId);
      return ok({});
    },
  };
}
