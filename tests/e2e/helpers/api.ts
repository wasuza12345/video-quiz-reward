// Thin wrappers over Playwright's `request` fixture (real HTTP through proxy.ts + the Next
// route handlers) for the public API surface (plan §4.1).
//
// Cookie handling is manual (UserSession), not Playwright's built-in context cookie jar:
// APIRequestContext (unlike a real browser) refuses to store/resend a `Secure`-flagged cookie
// received over plain http, and our proxy always sets `Secure: true` (matching prod https on
// Vercel — plan §4.1). A real browser accepts `Secure` over http://localhost/127.0.0.1 as a
// trustworthy origin (verified separately in proxy-secure-cookie.browser.spec.ts); the `request`
// fixture doesn't grant that exception, so every request would otherwise look cookie-less to the
// server and get a brand new identity. UserSession reads the raw Set-Cookie itself and resends it
// explicitly, which is what real HTTP through proxy.ts is exercising here anyway.
import type { APIRequestContext, APIResponse } from "@playwright/test";

const COOKIE_NAME = "vq_uid";

export class UserSession {
  private cookie?: string;

  constructor(
    private readonly ctx: APIRequestContext,
    initialCookie?: string,
  ) {
    this.cookie = initialCookie;
  }

  private headers(): Record<string, string> | undefined {
    return this.cookie ? { Cookie: this.cookie } : undefined;
  }

  private capture(res: APIResponse): APIResponse {
    const raw = res.headers()["set-cookie"];
    const match = raw?.match(new RegExp(`${COOKIE_NAME}=[^;,]+`));
    if (match) this.cookie = match[0];
    return res;
  }

  get(url: string): Promise<APIResponse> {
    return this.ctx.get(url, { headers: this.headers() }).then((res) => this.capture(res));
  }

  post(url: string, options: { data?: unknown } = {}): Promise<APIResponse> {
    return this.ctx.post(url, { data: options.data, headers: this.headers() }).then((res) => this.capture(res));
  }

  setCookie(value: string | undefined): void {
    this.cookie = value;
  }

  cookieValue(): string | undefined {
    return this.cookie;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ClientEventInput {
  seq: number;
  type: "PLAY" | "PAUSE" | "TICK" | "SEEK" | "TAB_HIDDEN" | "ENDED";
  positionSec: number;
}

export interface PublicVideoSummary {
  id: string;
  youtubeId: string;
  title: string;
  durationSec: number;
  rewardPoints: number;
  questionCount: number;
  rewarded: boolean;
}

export async function findVideoByYoutubeId(user: UserSession, youtubeId: string): Promise<PublicVideoSummary> {
  const res = await user.get("/api/videos");
  if (res.status() !== 200) throw new Error(`GET /api/videos failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { featured: PublicVideoSummary | null; videos: PublicVideoSummary[] };
  const all = [body.featured, ...body.videos].filter((v): v is PublicVideoSummary => v !== null);
  const video = all.find((v) => v.youtubeId === youtubeId);
  if (!video) throw new Error(`fixture video "${youtubeId}" not found in GET /api/videos — did the e2e seed run?`);
  return video;
}

export function createSession(user: UserSession, videoId: string): Promise<APIResponse> {
  return user.post("/api/sessions", { data: { videoId } });
}

export function postEvents(user: UserSession, sessionId: string, events: ClientEventInput[]): Promise<APIResponse> {
  return user.post(`/api/sessions/${sessionId}/events`, { data: { events } });
}

export function tick(user: UserSession, sessionId: string, seq: number, positionSec: number): Promise<APIResponse> {
  return postEvents(user, sessionId, [{ seq, type: "TICK", positionSec }]);
}

export function postAnswer(user: UserSession, sessionId: string, questionId: string, choice: string): Promise<APIResponse> {
  return user.post(`/api/sessions/${sessionId}/answer`, { data: { questionId, choice } });
}

export function claim(user: UserSession, sessionId: string): Promise<APIResponse> {
  return user.post(`/api/sessions/${sessionId}/claim`, { data: {} });
}

export function getMe(user: UserSession): Promise<APIResponse> {
  return user.get("/api/me");
}

/**
 * Watches `video` honestly in real wall-clock time from position 0: PLAY, then one TICK per
 * ~1.1 real seconds up to `toPositionSec` (a hair over 1s so credited `playedWallSec` clears the
 * 0.9×duration bar with margin — plan §6). Stops early if the server reports a state other than
 * PLAYING (e.g. it hit a quiz gate and moved to QUIZ_PENDING).
 */
export async function playHonestlyTo(
  user: UserSession,
  sessionId: string,
  opts: { fromSeq: number; fromPositionSec: number; toPositionSec: number },
): Promise<{ nextSeq: number; lastBody: EventsApplyBody }> {
  let seq = opts.fromSeq;
  let lastBody: EventsApplyBody | null = null;
  for (let pos = opts.fromPositionSec + 1; pos <= opts.toPositionSec; pos++) {
    await sleep(1100);
    const res = await tick(user, sessionId, seq, pos);
    if (res.status() !== 200) throw new Error(`TICK seq=${seq} pos=${pos} failed: ${res.status()} ${await res.text()}`);
    lastBody = (await res.json()) as EventsApplyBody;
    seq += 1;
    if (lastBody.state !== "PLAYING") break;
  }
  if (!lastBody) throw new Error("playHonestlyTo: no ticks were sent (toPositionSec <= fromPositionSec)");
  return { nextSeq: seq, lastBody };
}

export interface EventResult {
  seq: number;
  accepted: boolean;
  rejectReason: string | null;
}

export interface EventsApplyBody {
  state: string;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  currentQuestionId: string | null;
  results: EventResult[];
}

export interface SessionCreateBody {
  sessionId: string;
  state: string;
  positionSec: number;
  furthestSec: number;
  lastSeq: number;
  isReplay: boolean;
  alreadyRewarded: boolean;
  currentQuestionId: string | null;
  passedQuestionIds: string[];
  video: { id: string; youtubeId: string; title: string; channelName: string; durationSec: number; rewardPoints: number };
  quizzes: Array<{ id: string; triggerSec: number; prompt: string; choices: Array<{ label: string; text: string }> }>;
}

export interface ClaimBody {
  awarded: boolean;
  points: number;
  totalPoints: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; [key: string]: unknown };
}
