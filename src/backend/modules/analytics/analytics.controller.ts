import type { NextRequest } from "next/server";
import { requireAdmin } from "@/backend/common/auth/require-admin";
import { ok } from "@/backend/common/http/response";
import { parseBody } from "@/backend/common/validation/validate";
import { adminSessionsQuerySchema, adminStatsQuerySchema, pagingQuerySchema } from "@/shared/contracts/admin";
import type { AnalyticsService } from "./analytics.service";

function query(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams);
}

export function createAnalyticsController(deps: { analyticsService: AnalyticsService }) {
  return {
    async listUsers(request: NextRequest) {
      await requireAdmin(request);
      const { page, pageSize } = parseBody(pagingQuerySchema, query(request));
      return ok(await deps.analyticsService.listUsers(page, pageSize));
    },

    async userDetail(request: NextRequest, userId: string) {
      await requireAdmin(request);
      return ok(await deps.analyticsService.userDetail(userId));
    },

    async listSessions(request: NextRequest) {
      await requireAdmin(request);
      const { page, pageSize, videoId, flagged } = parseBody(adminSessionsQuerySchema, query(request));
      return ok(await deps.analyticsService.listSessions({ videoId, flagged }, page, pageSize));
    },

    async sessionDetail(request: NextRequest, sessionId: string) {
      await requireAdmin(request);
      return ok(await deps.analyticsService.sessionDetail(sessionId));
    },

    async stats(request: NextRequest) {
      await requireAdmin(request);
      const { videoId } = parseBody(adminStatsQuerySchema, query(request));
      return ok(await deps.analyticsService.stats(videoId));
    },
  };
}
