import type { z } from "zod";
import { AppError } from "../errors/app-error";

/** Parses `body` against `schema`, throwing 400 VALIDATION_ERROR with per-field issues on failure. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AppError("VALIDATION_ERROR", "invalid request body", { issues });
  }
  return result.data;
}
