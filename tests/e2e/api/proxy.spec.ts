// proxy.ts coverage (plan §10, items 1-7; item 8 is
// proxy-secure-cookie.browser.spec.ts). Every test builds its own UserSession(s) — its own
// cookie identity — never sharing one across tests.
import { expect, test, request as playwrightRequest } from "@playwright/test";
import { BASE_URL, BRIEF_VIDEO_YOUTUBE_ID } from "../helpers/env";
import { createSession, findVideoByYoutubeId, postEvents, UserSession } from "../helpers/api";

const COOKIE_NAME = "vq_uid";

function setCookieFor(res: { headers(): Record<string, string> }, name: string): string | undefined {
  const raw = res.headers()["set-cookie"];
  if (!raw || !raw.includes(`${name}=`)) return undefined;
  return raw;
}

test("1. first visit to / sets vq_uid: HttpOnly, Secure, SameSite=Lax, ~1y Max-Age, Path=/", async ({ request }) => {
  const user = new UserSession(request);
  const res = await user.get("/");
  const cookie = setCookieFor(res, COOKIE_NAME);
  expect(cookie, "expected a Set-Cookie for vq_uid on a cookie-less first request").toBeTruthy();
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).toMatch(/Path=\//);
  const maxAgeMatch = cookie!.match(/Max-Age=(\d+)/i);
  expect(maxAgeMatch, "expected a Max-Age attribute").toBeTruthy();
  expect(Number(maxAgeMatch![1])).toBeGreaterThan(365 * 24 * 60 * 60 - 10);
  expect(Number(maxAgeMatch![1])).toBeLessThan(365 * 24 * 60 * 60 + 10);
});

test("2. first-ever request (POST /api/sessions, no prior cookie) already succeeds", async ({ request }) => {
  // Look up the video id with the test's own (already cookie-bearing) session first — the actual
  // "first-ever request" assertion below uses a brand new UserSession that never sent a cookie.
  const lookup = new UserSession(request);
  const video = await findVideoByYoutubeId(lookup, BRIEF_VIDEO_YOUTUBE_ID);

  const fresh = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const freshUser = new UserSession(fresh);
    const res = await createSession(freshUser, video.id);
    expect(res.status(), await res.text()).toBe(200);
    const cookie = setCookieFor(res, COOKIE_NAME);
    expect(cookie, "the same response must carry the newly issued cookie").toBeTruthy();
    const body = await res.json();
    expect(body.sessionId).toBeTruthy();
  } finally {
    await fresh.dispose();
  }
});

test("3 & 6. a valid cookie is never re-issued, on /api/* or /watch/*", async ({ request }) => {
  const user = new UserSession(request);
  const first = await user.get("/api/me");
  expect(setCookieFor(first, COOKIE_NAME), "first request on a fresh session issues a cookie").toBeTruthy();

  const second = await user.get("/api/me");
  expect(second.headers()["set-cookie"], "a request with an already-valid cookie must not get a new one").toBeUndefined();

  const onWatch = await user.get("/watch/some-video-id");
  expect(onWatch.headers()["set-cookie"], "/watch/* with an already-valid cookie must not get a new one either").toBeUndefined();
});

test("4. a tampered cookie signature gets a new identity, and can't touch the old identity's session", async ({ request }) => {
  const owner = new UserSession(request);
  const video = await findVideoByYoutubeId(owner, BRIEF_VIDEO_YOUTUBE_ID);
  const created = await createSession(owner, video.id);
  expect(created.status()).toBe(200);
  const { sessionId } = await created.json();

  const attacker = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    // No context ever received a valid Set-Cookie for this value — it's sent explicitly, as a
    // forged/garbage vq_uid would arrive from a tampered client.
    const attackerUser = new UserSession(attacker, `${COOKIE_NAME}=not-a-real-signature.garbage`);
    const res = await postEvents(attackerUser, sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
    expect(res.status(), "a forged/garbage vq_uid must never own someone else's session").toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_OWNER");

    const cookie = setCookieFor(res, COOKIE_NAME);
    expect(cookie, "an invalid signature must be replaced with a freshly issued cookie").toBeTruthy();
    expect(cookie).not.toContain("not-a-real-signature.garbage");
  } finally {
    await attacker.dispose();
  }
});

test("5. matcher: /watch/* and /api/* get the cookie; /_next/static/* does not", async () => {
  const onWatch = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await new UserSession(onWatch).get("/watch/some-video-id");
    expect(setCookieFor(res, COOKIE_NAME), "/watch/* is in the matcher").toBeTruthy();
  } finally {
    await onWatch.dispose();
  }

  const onStatic = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await new UserSession(onStatic).get("/_next/static/does-not-exist.js");
    expect(res.headers()["set-cookie"], "/_next/static/* is not in the proxy matcher, regardless of status").toBeUndefined();
  } finally {
    await onStatic.dispose();
  }
});

test("7. /admin/* is guarded: unauthenticated page requests redirect to login, API requests get 401", async () => {
  const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const user = new UserSession(anon);
    // APIRequestContext follows redirects by default, so assert on the final URL rather than
    // the (by-then-200) status of the page it landed on.
    const page = await user.get("/admin");
    expect(page.url(), "unauthenticated /admin must redirect to the login page").toContain("/admin/login");

    const api = await user.get("/api/admin/stats");
    expect(api.status(), "unauthenticated /api/admin/* should be 401").toBe(401);
    expect((await api.json()).error.code).toBe("UNAUTHENTICATED");
  } finally {
    await anon.dispose();
  }
});
