import type { NextRequest } from "next/server";
import { requireUserId } from "@/backend/common/auth/user-cookie";
import { ok } from "@/backend/common/http/response";
import type { UserService } from "./user.service";

export function createUserController(deps: { userService: UserService }) {
  return {
    async getMe(request: NextRequest) {
      const userId = requireUserId(request);
      return ok(await deps.userService.getMe(userId));
    },
  };
}
