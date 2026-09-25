import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AppError } from "../errors/app-error";
import { ERROR_STATUS } from "../errors/error-codes";
import { errorResponse } from "./response";

function handleError(err: unknown): NextResponse {
  if (err instanceof AppError) return errorResponse(err);
  console.error(err);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "unexpected error" } }, { status: ERROR_STATUS.INTERNAL_ERROR });
}

/**
 * Wraps a route handler so every `AppError` becomes its documented JSON error response, and any
 * other thrown error becomes an opaque 500 (logged server-side, never leaked to the client).
 *
 * Overloaded on arity so a route with no dynamic segment gets back a one-argument function
 * (matching how it's actually called, including from tests) instead of a `ctx` nobody passes.
 */
export function withErrorHandling(handler: (request: NextRequest) => Promise<NextResponse>): (request: NextRequest) => Promise<NextResponse>;
export function withErrorHandling<Ctx>(
  handler: (request: NextRequest, ctx: Ctx) => Promise<NextResponse>,
): (request: NextRequest, ctx: Ctx) => Promise<NextResponse>;
export function withErrorHandling<Ctx>(handler: (request: NextRequest, ctx: Ctx) => Promise<NextResponse>) {
  return async (request: NextRequest, ctx: Ctx) => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      return handleError(err);
    }
  };
}
