// Shared test-only helpers: build authenticated requests and arrange fixture rows directly
// against the (local file DB) prisma client — the same one the routes under test use.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { issueUserCookieValue, USER_COOKIE_NAME } from "@/backend/common/auth/user-cookie";
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
