// Admin CRUD + timeline, and logout. Desktop-only — the admin panel is a
// data-table-heavy backoffice; the mobile-vs-desktop CSS pairing is exercised lightly by the
// AdminShell nav (both markups always render, CSS toggles which is visible), not by this flow's
// business logic, so duplicating the ~real-video-touching parts at 390×844 wouldn't add much.
import { expect, test } from "@playwright/test";
import { adminLogin } from "../helpers/admin";
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TEST_VIDEO_YOUTUBE_ID, BRIEF_VIDEO_YOUTUBE_ID } from "../../helpers/env";
import { exposeYouTubePlayerOnWindow, getPlayerCurrentTime, getPlayerState, resetWindowPlayer, seekPlayerTo, waitForPlayerDuration, waitForWindowPlayer } from "../helpers/player";

// Mirrors src/frontend/public/player/youtube-player-types.ts's YT_PLAYER_STATE — kept as raw
// numbers here (like the rest of this helper module) rather than importing app source into the
// Playwright test runner.
const YT_STATE_UNSTARTED = -1;
const YT_STATE_PAUSED = 2;
const YT_STATE_CUED = 5;
import { createSession, findVideoByYoutubeId, postEvents, UserSession } from "../../helpers/api";

test.setTimeout(120_000);

test("admin login: wrong password shows an error, correct password reaches the dashboard", async ({ page }) => {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(ADMIN_EMAIL);
  await page.locator("#admin-password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  // getByRole("alert") also matches Next's own route-announcer div — match the message text
  // directly instead.
  await expect(page.getByText("อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ")).toBeVisible();

  await page.locator("#admin-password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 15_000 });
  await expect(page.getByText("แดชบอร์ด").first()).toBeVisible();
});

// tester audit MINOR 3: AdminShell's own /api/admin/auth/me check used to treat EVERY failure
// (network error, timeout, 5xx) exactly like an expired session and redirect to login — a
// still-valid admin got kicked out just because the connection blipped.
test("AdminShell: a network failure on /api/admin/auth/me shows a retry state and stays on the page; a real 401 still redirects to login", async ({ page }) => {
  await adminLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.route("**/api/admin/auth/me", (route) => route.abort("failed"));
  await page.reload();
  await expect(page.getByText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"), "a network failure must show the retry error state").toBeVisible({ timeout: 10_000 });
  expect(page.url(), "must never have redirected to login over a network error").not.toContain("/admin/login");

  await page.unroute("**/api/admin/auth/me");
  await page.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(page.getByText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"), "retry must recover once the connection is back").not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("แดชบอร์ด").first()).toBeVisible();

  await page.route("**/api/admin/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "not logged in" } }) }),
  );
  await page.reload();
  await page.waitForURL(/\/admin\/login\?reason=expired/, { timeout: 10_000 });
});

// reviewer follow-up: a 401 with a non-JSON body (e.g. Vercel Deployment Protection's own HTML
// interstitial on a preview URL) used to parse as AdminApiError's "UNKNOWN" fallback code, so the
// UNAUTHENTICATED-only check never matched — the admin got stuck in the retry state forever
// instead of being sent to log in.
test("AdminShell: a 401 with a non-JSON body still redirects to login", async ({ page }) => {
  await adminLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.route("**/api/admin/auth/me", (route) => route.fulfill({ status: 401, contentType: "text/html", body: "<html><body>Authentication Required</body></html>" }));
  await page.reload();
  await page.waitForURL(/\/admin\/login\?reason=expired/, { timeout: 10_000 });
});

test("create video → publish → feature → shows on / → session timeline → locked fields → logout", async ({ page }) => {
  // Planner review: AdminSessionDetailPage's Fact component used to wrap `sub` in a <p>, and the
  // playedWallSec Fact passes a <ProgressBar> (renders a <div>) as sub — a <div> nested in a <p>
  // is invalid HTML, so React logged it as 2 separate console errors on every session detail page
  // (the Next dev overlay's "2 issues"). Collected for the whole test; checked around the session
  // detail page visit below.
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await exposeYouTubePlayerOnWindow(page);
  await adminLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const videoTitle = `admin test ${Date.now()}`;

  // Looked up up front (not inside a later step) so the finally-block restore below can run even
  // if this test fails before ever reaching the step that used to compute it — this test's own
  // "feature" step permanently changes the sitewide featured video, and every project in a run
  // shares one webServer/DB, so any later test that clicks the featured card would otherwise be
  // silently poisoned by whichever admin test video/failure state this one left behind.
  const user = new UserSession(page.request);
  const briefVideo = await findVideoByYoutubeId(user, BRIEF_VIDEO_YOUTUBE_ID);
  const briefVideoId = briefVideo.id;

  const restoreBriefVideoAsFeatured = () =>
    test.step("restore the seeded brief video as featured (runs even on failure — see comment above)", async () => {
      await page.goto(`/admin/videos/${briefVideoId}`);
      const alreadyFeatured = await page
        .getByText("★ คลิปแนะนำ")
        .isVisible()
        .catch(() => false);
      if (alreadyFeatured) return;
      await page.getByRole("button", { name: "ตั้งเป็นคลิปแนะนำ" }).click();
      await expect(page.getByText("★ คลิปแนะนำ")).toBeVisible({ timeout: 10_000 });
    });

  try {
    await runAdminCrudFlow(page, videoTitle, briefVideoId, consoleErrors);
  } finally {
    await restoreBriefVideoAsFeatured();
  }

  await test.step("logout redirects to the login page, and /admin then requires logging in again", async () => {
    await page.getByRole("button", { name: "ออกจากระบบ" }).click();
    await page.waitForURL(/\/admin\/login\?reason=logout/, { timeout: 10_000 });
    await expect(page.getByText("ออกจากระบบเรียบร้อยแล้วค่ะ")).toBeVisible();

    await page.goto("/admin");
    await page.waitForURL(/\/admin\/login/, { timeout: 10_000 });
  });
});

async function runAdminCrudFlow(page: import("@playwright/test").Page, videoTitle: string, briefVideoId: string, consoleErrors: string[]): Promise<void> {
  let createdVideoUrl = "";

  await test.step("create a video from a YouTube URL", async () => {
    await page.goto("/admin/videos/new");
    // The preview player only mounts once youtubeUrl parses to an id — fill it first.
    await page.getByLabel("ลิงก์ YouTube").fill(`https://youtu.be/${ADMIN_TEST_VIDEO_YOUTUBE_ID}`);
    await waitForWindowPlayer(page);
    await waitForPlayerDuration(page); // the raw player reports a duration...
    // ...but AdminVideoFormPage's own `durationSec` state (what Save actually validates) only
    // catches up on YouTubePreview's own 200ms poll + a re-render — wait for the durationSec
    // field's own displayed value instead of racing that.
    await expect(page.getByLabel("ความยาว")).not.toHaveValue("", { timeout: 10_000 });
    await page.getByLabel("ชื่อคลิป").fill(videoTitle);

    // This is a client-side router.push (SPA nav, not a reload): window.__ytPlayer would
    // otherwise still hold the create page's (about-to-be-destroyed) instance.
    await resetWindowPlayer(page);
    await page.getByRole("button", { name: "บันทึกและเพิ่มคำถาม" }).click();
    // "/admin/videos/new" itself matches a naive `[^/]+$` pattern — require a real id (uuid).
    // Generous timeout: saving hits the real youtube.com oEmbed server-side (plan §7).
    await page.waitForURL(/\/admin\/videos\/[0-9a-f-]{20,}$/, { timeout: 40_000 });
    createdVideoUrl = page.url();
  });

  await test.step("creating another video with the same YouTube link shows the duplicate copy, not the generic invalid-link one (tester audit MINOR 1)", async () => {
    await page.goto("/admin/videos/new");
    await page.getByLabel("ลิงก์ YouTube").fill(`https://youtu.be/${ADMIN_TEST_VIDEO_YOUTUBE_ID}`);
    await waitForWindowPlayer(page);
    await waitForPlayerDuration(page);
    await expect(page.getByLabel("ความยาว")).not.toHaveValue("", { timeout: 10_000 });
    await page.getByLabel("ชื่อคลิป").fill(`${videoTitle} (duplicate attempt)`);

    await resetWindowPlayer(page);
    await page.getByRole("button", { name: "บันทึกและเพิ่มคำถาม" }).click();
    await expect(page.getByText("คลิปนี้ถูกเพิ่มไว้แล้วค่ะ"), "must show the duplicate copy, not the generic invalid-link one").toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ลิงก์ YouTube ไม่ถูกต้อง"), "must not show the generic invalid-link copy for a duplicate").not.toBeVisible();
    expect(page.url(), "a rejected save must not navigate away").toContain("/admin/videos/new");

    // Back to the video this flow actually owns — the rest of the flow expects to be there.
    // A real navigation (not router.push), so window.__ytPlayer is already gone on its own.
    await page.goto(createdVideoUrl);
  });

  await test.step('add a question using "ใช้เวลาปัจจุบัน"', async () => {
    await waitForWindowPlayer(page); // the fresh preview-player instance on the edit page
    await waitForPlayerDuration(page);

    await page.getByRole("button", { name: "+ เพิ่มคำถาม" }).click();
    // exact: true — "คำถาม" is otherwise a substring match of "เวลาที่คำถามขึ้น" (the trigger field).
    await page.getByLabel("คำถาม", { exact: true }).fill("Test question?");
    await page.getByLabel("ข้อความตัวเลือก A").fill("Choice A");
    await page.getByLabel("ข้อความตัวเลือก B").fill("Choice B");

    // Tester audit: "ไปที่เวลานี้" on a preview that has never been played used to leave the video
    // fully black — seekTo() alone doesn't render a frame on an UNSTARTED/CUED player. Check this
    // right here, before the seekPlayerTo() below ever plays this same instance. A real player is
    // already CUED (not UNSTARTED) by the time getDuration() reports real metadata — either is
    // "never played", both are the black-frame states the fix targets.
    expect([YT_STATE_UNSTARTED, YT_STATE_CUED], "sanity: the preview must not have been played yet").toContain(await getPlayerState(page));
    await page.getByLabel("เวลาที่คำถามขึ้น").fill("0:10.0");
    await page.getByRole("button", { name: "ไปที่เวลานี้" }).click();
    await expect.poll(() => getPlayerState(page), { timeout: 10_000, message: "the preview must end up genuinely paused, not stuck mid-unstick" }).toBe(YT_STATE_PAUSED);
    await expect.poll(() => getPlayerCurrentTime(page), { timeout: 5_000 }).toBeGreaterThan(9);
    await page.getByLabel("เวลาที่คำถามขึ้น").fill("");

    await seekPlayerTo(page, 5, true);

    // "ใช้เวลาปัจจุบัน" only enables once the 200ms onTimeUpdate poll observes currentTime > 0
    // after the seek above — not instant, so poll the button's own state rather than a fixed sleep.
    const useCurrentTimeBtn = page.getByRole("button", { name: "ใช้เวลาปัจจุบัน" });
    await expect(useCurrentTimeBtn).toBeEnabled({ timeout: 10_000 });
    await useCurrentTimeBtn.click();
    await expect(page.getByText(/ตั้งเวลาเป็น/), "the announcement confirms the trigger field was set from the preview's current time").toBeVisible();

    await page.getByRole("button", { name: "บันทึกคำถาม" }).click();
    await expect(page.getByText(/⏱.*Test question\?/), "the saved question's collapsed summary must show").toBeVisible({ timeout: 10_000 });
  });

  await test.step("publish, then feature", async () => {
    await page.getByRole("button", { name: "เผยแพร่" }).click();
    const featureBtn = page.getByRole("button", { name: "ตั้งเป็นคลิปแนะนำ" });
    await expect(featureBtn, "Feature only becomes available once published").toBeVisible({ timeout: 10_000 });
    await featureBtn.click();
    await expect(page.getByText("★ คลิปแนะนำ")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the public homepage now features it", async () => {
    await page.goto("/");
    await expect(page.locator("a.featured-card")).toContainText(videoTitle, { timeout: 10_000 });
  });

  let flaggedSessionId = "";
  await test.step("manufacture a flagged/rejected session (real HTTP) for the reject/flag timeline check", async () => {
    // UserSession, not raw page.request: APIRequestContext — even page.request, bound to this
    // same browser context — doesn't reliably persist a Secure-flagged cookie across calls over
    // plain http (same limitation the API-level suite's helpers/api.ts works around); a real
    // page.goto() navigation does (proxy-secure-cookie.browser.spec.ts), but plain page.request
    // calls apparently don't share that. UserSession manages the cookie itself instead.
    const user = new UserSession(page.request);
    const created = await createSession(user, briefVideoId);
    const { sessionId } = (await created.json()) as { sessionId: string };
    flaggedSessionId = sessionId;
    await postEvents(user, sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
    // furthestSec is still 0, so a TICK to 20 needs 20s — more than the 10s bank could ever hold
    // → a hard SEEK_FORWARD reject, flagged immediately (same rule the API-level suite exercises).
    await postEvents(user, sessionId, [{ seq: 2, type: "TICK", positionSec: 20 }]);
  });

  await test.step("admin sessions: the flagged filter surfaces it, and the detail shows the reject chip + flag badge", async () => {
    await page.goto("/admin/sessions");
    // .click(), not .check(): the checkbox's `checked` only flips once the router.push(?flagged=
    // true) round-trips back through searchParams, which briefly races Playwright's own
    // post-click "did the state actually change" verification that .check() does.
    await page.getByLabel("เฉพาะที่ถูกแจ้งเตือน 🚩").click();
    await page.waitForURL(/flagged=true/);
    await expect(page.getByRole("link", { name: /^\S{6,}/ }).first(), "the flagged list must not be empty").toBeVisible({ timeout: 10_000 });

    // Desktop table + mobile list both render in the DOM at once (CSS toggles visibility) — every
    // text assertion below needs .first() to avoid a strict-mode multiple-match error.
    await page.goto(`/admin/sessions/${flaggedSessionId}`);
    await expect(page.getByText("ถูกแจ้งเตือน").first()).toBeVisible();
    await expect(page.getByText("SEEK_FORWARD").first()).toBeVisible();
    await expect(page.getByText("🚩 ทำให้ถูกแจ้งเตือน").first()).toBeVisible();
  });

  await test.step("admin sessions: an honestly-completed session shows TICK collapsing + ANSWER/CLAIM", async () => {
    // A real page.goto + DOM read, not page.request: page.request doesn't reliably carry this
    // browser context's cookies either (same limitation as the manufactured-session step above).
    await page.goto(`/admin/sessions?videoId=${briefVideoId}`);
    // "ดูจบ" (ENDED) + a "+N" points value + NOT "ดูทบทวน" (replay) — from 01-honest-flow.spec.ts,
    // which runs earlier in this same project/worker. Desktop <tr> rows only (mobile is <li>).
    const rewardedRow = page
      .locator("tr", { hasText: "ดูจบ" })
      .filter({ hasText: /\+\d+/ })
      .filter({ hasNotText: "ดูทบทวน" })
      .first();
    await expect(rewardedRow, "expected at least one honestly-completed & rewarded session on the brief video (from the honest-flow spec)").toBeVisible({
      timeout: 10_000,
    });
    const pointsText = await rewardedRow.locator("td").last().innerText();
    const points = Number(pointsText.replace(/[^\d]/g, ""));

    const consoleErrorsBeforeDetail = consoleErrors.length;
    await rewardedRow.getByRole("link").first().click();
    await page.waitForURL(/\/admin\/sessions\/[0-9a-f-]{20,}$/, { timeout: 10_000 });

    // playedWallSec's Fact renders a <ProgressBar> (a <div>) as `sub` — used to be wrapped in a
    // <p>, invalid HTML that logged 2 console errors on every visit (the dev overlay's "2 issues").
    expect(
      consoleErrors.slice(consoleErrorsBeforeDetail),
      "the session detail page must log 0 console errors",
    ).toEqual([]);

    // .first(): desktop table + mobile list both render in the DOM at once.
    const collapsedGroup = page.getByRole("button", { name: /ความคืบหน้า ×/ }).first();
    await expect(collapsedGroup, "consecutive accepted TICKs must collapse into one group").toBeVisible({ timeout: 10_000 });
    const groupCountBefore = await page.locator("tr", { hasText: "ความคืบหน้า ×" }).count();

    await collapsedGroup.click();
    const groupCountAfter = await page.locator("tr", { hasText: "ความคืบหน้า" }).count();
    expect(groupCountAfter, "expanding the group must reveal more rows than the single collapsed summary row").toBeGreaterThan(groupCountBefore);

    await expect(page.locator("tr", { hasText: "ตอบ" }).first(), "the ANSWER row must summarize the choice + correctness").toBeVisible();
    await expect(page.locator("tr", { hasText: `+${points}` }).first(), "the CLAIM row must summarize the points").toBeVisible();
  });

  await test.step("a locked video (the brief one, already watched) disables its locked fields", async () => {
    await page.goto("/admin/videos");
    // .first(): desktop table + mobile list both render in the DOM at once.
    await page.getByRole("link", { name: /ตัวอย่างคลิป/ }).first().click();
    await page.waitForURL(/\/admin\/videos\/[^/]+$/, { timeout: 10_000 });
    await expect(page.locator("#video-locked-notice"), "a video with sessions must show the lock notice").toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Where does the flower bloom/ }).click();
    await expect(page.getByRole("radio", { name: "เฉลย D" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "ใช้เวลาปัจจุบัน" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "ลบคำถาม" })).toBeDisabled();
    // tester audit MINOR 2: locked fields must be genuinely disabled, matching the buttons above
    // (readOnly + aria-disabled used to leave them focusable/tabbable).
    await expect(page.getByLabel("ลิงก์ YouTube")).toBeDisabled();
    await expect(page.getByLabel("ความยาว")).toBeDisabled();
  });

  // Planner review: Table.tsx and SessionTimeline.tsx's own mobile <div>/<ul> both carried an
  // inline style={{ display: "flex" }} — inline styles always beat a class-based media query, so
  // ≥601px showed the desktop <table> AND the mobile card list at once (fixed: dropped the inline
  // display, left it to .admin-table-mobile's CSS). Checks both components, both breakpoints —
  // this project's default 1280px viewport, then resized to 390px (restored after).
  await test.step("desktop shows only the table, 390px shows only the mobile cards (Table.tsx + SessionTimeline.tsx)", async () => {
    await page.goto("/admin/videos");
    await expect(page.locator(".admin-table-desktop").first(), "1280px: the table must be visible").toBeVisible();
    await expect(page.locator(".admin-table-mobile").first(), "1280px: the mobile card list must be hidden").toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".admin-table-desktop").first(), "390px: the table must be hidden").toBeHidden();
    await expect(page.locator(".admin-table-mobile").first(), "390px: the mobile card list must be visible").toBeVisible();

    await page.goto(`/admin/sessions/${flaggedSessionId}`);
    await expect(page.locator(".admin-table-desktop").first(), "390px, SessionTimeline: the table must be hidden").toBeHidden();
    await expect(page.locator(".admin-table-mobile").first(), "390px, SessionTimeline: the mobile list must be visible").toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(".admin-table-desktop").first(), "1280px, SessionTimeline: the table must be visible").toBeVisible();
    await expect(page.locator(".admin-table-mobile").first(), "1280px, SessionTimeline: the mobile list must be hidden").toBeHidden();
  });
}
