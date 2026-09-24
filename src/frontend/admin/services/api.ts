// Thin fetch wrappers for the admin API (plan §4.4). Every call includes credentials so the
// vq_admin cookie rides along; none of these touch `backend/`.
import type { AdminLoginBody, AdminMeResponse } from "@/shared/contracts/admin-auth";
import type {
  AdminCreateQuestionBody,
  AdminCreateVideoBody,
  AdminQuestionDetail,
  AdminSessionDetail,
  AdminStats,
  AdminUpdateQuestionBody,
  AdminUpdateVideoBody,
  AdminUserDetail,
  AdminUserListItem,
  AdminVideoDetail,
  AdminVideoListItem,
  Paged,
  SessionRow,
} from "@/shared/contracts/admin";
import type { ApiErrorBody } from "@/shared/contracts/session";

export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = body.error.code;
    this.extra = Object.fromEntries(Object.entries(body.error).filter(([key]) => key !== "code" && key !== "message"));
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: { code: "UNKNOWN", message: res.statusText } }))) as ApiErrorBody;
    throw new AdminApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function withBody<T>(method: string, url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const adminApi = {
  // ---------- auth ----------
  login: (body: AdminLoginBody) => withBody<{ id: string; email: string }>("POST", "/api/admin/auth/login", body),
  logout: () => withBody<Record<string, never>>("POST", "/api/admin/auth/logout"),
  me: () => request<AdminMeResponse>("/api/admin/auth/me"),

  // ---------- videos ----------
  listVideos: (page = 1, pageSize = 100) => request<Paged<AdminVideoListItem>>(`/api/admin/videos${query({ page, pageSize })}`),
  createVideo: (body: AdminCreateVideoBody) => withBody<AdminVideoListItem>("POST", "/api/admin/videos", body),
  getVideo: (id: string) => request<AdminVideoDetail>(`/api/admin/videos/${id}`),
  updateVideo: (id: string, body: AdminUpdateVideoBody) => withBody<AdminVideoListItem>("PATCH", `/api/admin/videos/${id}`, body),
  publishVideo: (id: string) => withBody<AdminVideoListItem>("POST", `/api/admin/videos/${id}/publish`),
  archiveVideo: (id: string) => withBody<AdminVideoListItem>("POST", `/api/admin/videos/${id}/archive`),
  featureVideo: (id: string) => withBody<AdminVideoListItem>("POST", `/api/admin/videos/${id}/feature`),

  // ---------- quiz questions ----------
  createQuestion: (videoId: string, body: AdminCreateQuestionBody) => withBody<AdminQuestionDetail>("POST", `/api/admin/videos/${videoId}/questions`, body),
  updateQuestion: (id: string, body: AdminUpdateQuestionBody) => withBody<AdminQuestionDetail>("PATCH", `/api/admin/questions/${id}`, body),
  deleteQuestion: (id: string) => withBody<Record<string, never>>("DELETE", `/api/admin/questions/${id}`),

  // ---------- users ----------
  listUsers: (page = 1, pageSize = 20) => request<Paged<AdminUserListItem>>(`/api/admin/users${query({ page, pageSize })}`),
  getUser: (id: string) => request<AdminUserDetail>(`/api/admin/users/${id}`),

  // ---------- sessions ----------
  listSessions: (params: { videoId?: string; flagged?: boolean; page?: number; pageSize?: number } = {}) =>
    request<Paged<SessionRow>>(`/api/admin/sessions${query({ videoId: params.videoId, flagged: params.flagged, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`),
  getSession: (id: string) => request<AdminSessionDetail>(`/api/admin/sessions/${id}`),

  // ---------- stats ----------
  getStats: (videoId?: string) => request<AdminStats>(`/api/admin/stats${query({ videoId })}`),
};
