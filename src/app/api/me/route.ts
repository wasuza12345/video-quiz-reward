import { withErrorHandling } from "@/backend/common/http/handler";
import { getContainer } from "@/backend/container";

export const GET = withErrorHandling(async (request) => getContainer().rewardController.getMe(request));
