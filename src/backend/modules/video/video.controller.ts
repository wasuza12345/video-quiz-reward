import type { NextRequest } from "next/server";
import { AppError } from "@/backend/common/errors/app-error";
import { requireUserId } from "@/backend/common/auth/user-cookie";
import { checkOrigin } from "@/backend/common/auth/origin-check";
import { requireAdmin } from "@/backend/common/auth/require-admin";
import { readJsonBody } from "@/backend/common/http/body-limit";
import { ok } from "@/backend/common/http/response";
import { parseBody } from "@/backend/common/validation/validate";
import { adminCreateVideoBodySchema, adminUpdateVideoBodySchema, pagingQuerySchema } from "@/shared/contracts/admin";
import type { VideoService } from "./video.service";

function requireOrigin(request: NextRequest): void {
  if (!checkOrigin(request)) throw new AppError("BAD_ORIGIN", "origin does not match host");
}

export function createVideoController(deps: { videoService: VideoService }) {
  return {
    async listVideos(request: NextRequest) {
      const userId = requireUserId(request);
      return ok(await deps.videoService.listVideos(userId));
    },

    async adminList(request: NextRequest) {
      await requireAdmin(request);
      const { page, pageSize } = parseBody(pagingQuerySchema, Object.fromEntries(request.nextUrl.searchParams));
      return ok(await deps.videoService.adminList(page, pageSize));
    },

    async adminCreate(request: NextRequest) {
      await requireAdmin(request);
      requireOrigin(request);
      const body = parseBody(adminCreateVideoBodySchema, await readJsonBody(request));
      return ok(await deps.videoService.adminCreate(body));
    },

    async adminDetail(request: NextRequest, id: string) {
      await requireAdmin(request);
      return ok(await deps.videoService.adminDetail(id));
    },

    async adminUpdate(request: NextRequest, id: string) {
      await requireAdmin(request);
      requireOrigin(request);
      const body = parseBody(adminUpdateVideoBodySchema, await readJsonBody(request));
      return ok(await deps.videoService.adminUpdate(id, body));
    },

    async adminPublish(request: NextRequest, id: string) {
      await requireAdmin(request);
      requireOrigin(request);
      return ok(await deps.videoService.adminPublish(id));
    },

    async adminArchive(request: NextRequest, id: string) {
      await requireAdmin(request);
      requireOrigin(request);
      return ok(await deps.videoService.adminArchive(id));
    },

    async adminFeature(request: NextRequest, id: string) {
      await requireAdmin(request);
      requireOrigin(request);
      return ok(await deps.videoService.adminFeature(id));
    },
  };
}
