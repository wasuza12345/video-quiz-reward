// Thin fetch wrappers for the public API (plan §4.1). Every call includes credentials so the
// signed vq_uid cookie rides along; none of these touch `backend/`.
import type {
  AnswerResponse,
  ApiErrorBody,
  ClaimResponse,
  ClientEventType,
  EventsApplyResponse,
  SessionCreateResponse,
} from "@/shared/contracts/session";
import type { MeResponse, VideoListResponse } from "@/shared/contracts/video";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.extra = Object.fromEntries(Object.entries(body.error).filter(([key]) => key !== "code" && key !== "message"));
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: { code: "UNKNOWN", message: res.statusText } }))) as ApiErrorBody;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export const api = {
  getMe: () => request<MeResponse>("/api/me"),
  getVideos: () => request<VideoListResponse>("/api/videos"),
  createSession: (videoId: string) => postJson<SessionCreateResponse>("/api/sessions", { videoId }),
  postEvents: (sessionId: string, events: Array<{ seq: number; type: ClientEventType; positionSec: number; clientAt?: string }>) =>
    postJson<EventsApplyResponse>(`/api/sessions/${sessionId}/events`, { events }),
  postAnswer: (sessionId: string, questionId: string, choice: string) =>
    postJson<AnswerResponse>(`/api/sessions/${sessionId}/answer`, { questionId, choice }),
  postClaim: (sessionId: string) => postJson<ClaimResponse>(`/api/sessions/${sessionId}/claim`, {}),
};
