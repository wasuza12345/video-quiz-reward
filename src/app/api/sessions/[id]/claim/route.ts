import type { NextRequest } from "next/server";
import { withErrorHandling } from "@/backend/common/http/handler";
import { getContainer } from "@/backend/container";

export const POST = withErrorHandling(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return getContainer().rewardController.claim(request, id);
});
