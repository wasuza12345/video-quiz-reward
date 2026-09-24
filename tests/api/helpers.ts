// Shared test-only helpers: build authenticated requests and arrange fixture rows directly
// against the (local file DB) prisma client — the same one the routes under test use.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/backend/common/auth/admin-session";
import { ADMIN_DEVICE_COOKIE_NAME } from "@/backend/common/auth/admin-device-cookie";
import { issueUserCookieValue, USER_COOKIE_NAME } from "@/backend/common/auth/user-cookie";
import { hashPassword } from "@/backend/lib/password";
import { prisma } from "@/backend/lib/prisma";

export function newUserId(): string {
  return randomUUID();
}

interface AuthedRequestInit {
  method?: string;
  body?: BodyInit;
  headers?: HeadersInit;
  userId?: string;
}

/** A NextRequest carrying a valid, verifiable `vq_uid` cookie for `userId` (or a fresh one). */
export function authedRequest(url: string, init: AuthedRequestInit = {}): NextRequest {
  const { userId, headers, ...rest } = init;
  const { value } = issueUserCookieValue(userId);
  const h = new Headers(headers);
  h.set("cookie", `${USER_COOKIE_NAME}=${value}`);
  if (rest.body !== undefined && !h.has("content-type")) h.set("content-type", "application/json");
  return new NextRequest(url, { ...rest, headers: h });
}

export function postJson(url: string, body: unknown, opts: { userId?: string } = {}): NextRequest {
  return authedRequest(url, { method: "POST", body: JSON.stringify(body), userId: opts.userId });
}

export function paramsOf(id: string) {
  return { params: Promise.resolve({ id }) };
}

export async function createTestVideo(overrides: Partial<{
  title: string;
  channelName: string;
  durationSec: number;
  rewardPoints: number;
  status: "draft" | "published" | "archived";
  isFeatured: boolean;
}> = {}) {
  return prisma.video.create({
    data: {
      youtubeId: `test-${randomUUID()}`,
      title: "Test Video",
      channelName: "Test Channel",
      durationSec: 44,
      rewardPoints: 50,
      status: "published",
      isFeatured: false,
      publishedAt: new Date(),
      ...overrides,
    },
  });
}

export async function createTestAdmin(overrides: Partial<{ email: string; password: string }> = {}) {
  const email = (overrides.email ?? `admin-${randomUUID()}@test.local`).toLowerCase();
  const password = overrides.password ?? "correct horse battery staple";
  const admin = await prisma.admin.create({ data: { email, passwordHash: await hashPassword(password) } });
  return { ...admin, password };
}

interface AdminRequestInit {
  method?: string;
  body?: unknown;
  /** Omit to auto-match the URL's own origin (the "valid" case); pass a string for a mismatch;
   * pass `null` to omit the header entirely (also invalid — origin-check treats missing as bad). */
  origin?: string | null;
  adminCookie?: string;
  /** The `vq_admin_dev` "known device" cookie value (see admin-device-cookie.ts). */
  deviceCookie?: string;
  ip?: string;
}

/** A NextRequest for `/api/admin/**`, with `Host`/`Origin` wired for `checkOrigin` and, optionally,
 * `vq_admin`/`vq_admin_dev` cookies — everything the admin-auth layer reads from a real request. */
export function adminRequest(url: string, init: AdminRequestInit = {}): NextRequest {
  const u = new URL(url);
  const headers = new Headers();
  headers.set("host", u.host);
  if (init.origin !== null) headers.set("origin", init.origin ?? u.origin);
  const cookiePairs: string[] = [];
  if (init.adminCookie) cookiePairs.push(`${ADMIN_COOKIE_NAME}=${init.adminCookie}`);
  if (init.deviceCookie) cookiePairs.push(`${ADMIN_DEVICE_COOKIE_NAME}=${init.deviceCookie}`);
  if (cookiePairs.length > 0) headers.set("cookie", cookiePairs.join("; "));
  if (init.ip) headers.set("x-real-ip", init.ip);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export async function createTestQuestion(videoId: string, triggerSec = 13) {
  return prisma.quizQuestion.create({
    data: {
      videoId,
      triggerSec,
      prompt: "Test question?",
      correctChoice: "D",
      choices: {
        create: [
          { label: "A", text: "a" },
          { label: "B", text: "b" },
          { label: "C", text: "c" },
          { label: "D", text: "d" },
        ],
      },
    },
  });
}
