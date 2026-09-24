import type { NextRequest } from "next/server";
import { withErrorHandling } from "@/backend/common/http/handler";
import { getContainer } from "@/backend/container";

export const PATCH = withErrorHandling(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return getContainer().questionController.update(request, id);
});

export const DELETE = withErrorHandling(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return getContainer().questionController.remove(request, id);
});
