import { withErrorHandling } from "@/backend/common/http/handler";
import { getContainer } from "@/backend/container";

export const POST = withErrorHandling(async (request) => getContainer().adminAuthController.logout(request));
