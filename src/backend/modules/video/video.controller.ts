import type { NextRequest } from "next/server";
import { requireUserId } from "@/backend/common/auth/user-cookie";
import { ok } from "@/backend/common/http/response";
import type { VideoService } from "./video.service";

export function createVideoController(deps: { videoService: VideoService }) {
  return {
    async listVideos(request: NextRequest) {
      const userId = requireUserId(request);
      return ok(await deps.videoService.listVideos(userId));
    },
  };
}
