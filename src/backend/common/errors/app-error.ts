import { ERROR_STATUS, type ErrorCode } from "./error-codes";

/** Thrown by controllers/services for every documented public API error (plan §4.1). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.extra = extra;
  }
}
