import { NextResponse } from "next/server";
import { AppError } from "../errors/app-error";

/** `{ data }` is not part of the contract — success responses are the shaped object itself. */
export function ok<T extends object>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Errors: `{ error: { code, message, ...extra } }` (plan §4). */
export function errorResponse(err: AppError) {
  return NextResponse.json({ error: { code: err.code, message: err.message, ...err.extra } }, { status: err.status });
}
