import { EVENT_CAPS } from "@/shared/constants/session";
import { AppError } from "../errors/app-error";

/** Reads and JSON-parses a request body, enforcing the 16 KB cap (plan §4) before parsing. */
export async function readJsonBody(request: Request): Promise<unknown> {
  // Reject on a declared oversized Content-Length before buffering the body at all; a missing
  // or understated header (e.g. chunked transfer) still gets caught by the post-read check below.
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > EVENT_CAPS.MAX_BODY_BYTES) {
    throw new AppError("BODY_TOO_LARGE", "request body exceeds 16 KB");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > EVENT_CAPS.MAX_BODY_BYTES) {
    throw new AppError("BODY_TOO_LARGE", "request body exceeds 16 KB");
  }
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "body is not valid JSON");
  }
}
