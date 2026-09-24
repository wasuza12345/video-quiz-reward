import type { NextRequest } from "next/server";
import { requireUserId } from "@/backend/common/auth/user-cookie";
import { readJsonBody } from "@/backend/common/http/body-limit";
import { ok } from "@/backend/common/http/response";
import { parseBody } from "@/backend/common/validation/validate";
import { answerBodySchema, createSessionBodySchema, postEventsBodySchema } from "@/shared/contracts/session";
import type { WatchSessionService } from "./watch-session.service";

export function createWatchSessionController(deps: { watchSessionService: WatchSessionService }) {
  return {
    async createSession(request: NextRequest) {
      const userId = requireUserId(request);
      const { videoId } = parseBody(createSessionBodySchema, await readJsonBody(request));
      return ok(await deps.watchSessionService.createOrResume(userId, videoId));
    },

    async postEvents(request: NextRequest, sessionId: string) {
      const userId = requireUserId(request);
      const { events } = parseBody(postEventsBodySchema, await readJsonBody(request));
      return ok(await deps.watchSessionService.applyEvents(sessionId, userId, events));
    },

    async postAnswer(request: NextRequest, sessionId: string) {
      const userId = requireUserId(request);
      const { questionId, choice } = parseBody(answerBodySchema, await readJsonBody(request));
      return ok(await deps.watchSessionService.applyAnswer(sessionId, userId, questionId, choice));
    },
  };
}
