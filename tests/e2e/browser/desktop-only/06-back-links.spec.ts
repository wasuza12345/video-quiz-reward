// Every sub-page (admin detail/form pages, and the public watch page) gets a visible "back to
// parent" link. Runs once, toggling viewport imperatively for the 390 checks, rather than
// duplicating a real-video-touching flow across the ui-desktop/ui-mobile projects — same rationale
// as 02-admin.spec.ts's own "desktop-only" comment.
import { expect, test } from "@playwright/test";
import { adminLogin } from "../helpers/admin";
import { ADMIN_EMAIL, ADMIN_PASSWORD, BRIEF_VIDEO_YOUTUBE_ID } from "../../helpers/env";
import { createSession, findVideoByYoutubeId, UserSession } from "../../helpers/api";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

test.setTimeout(60_000);

test("back links: admin sub-pages and the public watch page each show one, at 1280 and 390, and it lands on the parent", async ({ page }) => {
  // Manufacture a real session (no events needed — a fresh CREATED session is enough to reach the
  // detail pages) so the users/sessions detail pages have a real row to visit directly.
  const user = new UserSession(page.request);
  const video = await findVideoByYoutubeId(user, BRIEF_VIDEO_YOUTUBE_ID);
  const created = await createSession(user, video.id);
  const { sessionId } = (await created.json()) as { sessionId: string };

  await adminLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  // videos/new
  await page.goto("/admin/videos/new");
  await expect(page.getByRole("link", { name: "← กลับไปรายการคลิป", exact: true })).toBeVisible();
  await page.setViewportSize(MOBILE);
  await expect(page.getByRole("link", { name: "← กลับไปรายการคลิป", exact: true })).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await page.getByRole("link", { name: "← กลับไปรายการคลิป", exact: true }).click();
  await page.waitForURL(/\/admin\/videos$/);

  // videos/[id]
  await page.goto(`/admin/videos/${video.id}`);
  await expect(page.getByRole("link", { name: "← กลับไปรายการคลิป", exact: true })).toBeVisible();
  await page.setViewportSize(MOBILE);
  await expect(page.getByRole("link", { name: "← กลับไปรายการคลิป", exact: true })).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await page.getByRole("link", { name: "← กลับไปรายการคลิป", exact: true }).click();
  await page.waitForURL(/\/admin\/videos$/);

  // sessions/[id] — navigated to directly (no list filter to preserve in this check)
  await page.goto(`/admin/sessions/${sessionId}`);
  await expect(page.getByRole("link", { name: "← กลับไปรายการเซสชัน", exact: true })).toBeVisible();
  await page.setViewportSize(MOBILE);
  await expect(page.getByRole("link", { name: "← กลับไปรายการเซสชัน", exact: true })).toBeVisible();
  await page.setViewportSize(DESKTOP);

  const userHref = await page.locator('a[href^="/admin/users/"]').first().getAttribute("href");
  expect(userHref, "the session detail page must link to its user").toBeTruthy();

  await page.getByRole("link", { name: "← กลับไปรายการเซสชัน", exact: true }).click();
  await page.waitForURL(/\/admin\/sessions$/);

  // users/[id]
  await page.goto(userHref!);
  await expect(page.getByRole("link", { name: "← กลับไปรายชื่อผู้ใช้", exact: true })).toBeVisible();
  await page.setViewportSize(MOBILE);
  await expect(page.getByRole("link", { name: "← กลับไปรายชื่อผู้ใช้", exact: true })).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await page.getByRole("link", { name: "← กลับไปรายชื่อผู้ใช้", exact: true }).click();
  await page.waitForURL(/\/admin\/users$/);

  // /watch/[id] (public) — desktop shows the new BackLink; mobile keeps only PublicHeader's own
  // back icon, so the new one must stay hidden there (must not duplicate it).
  await page.goto(`/watch/${video.id}`);
  const watchBackLink = page.getByRole("link", { name: "← กลับไปหน้ารวมคลิป", exact: true });
  await expect(watchBackLink).toBeVisible();
  await page.setViewportSize(MOBILE);
  await expect(watchBackLink, "must not duplicate PublicHeader's own mobile back icon").toBeHidden();
  // PublicHeader's icon: aria-label only, no visible text — a different, exact name from the
  // BackLink's own "← ..." label above, so this can't accidentally match it either way.
  await expect(page.getByRole("link", { name: "กลับไปหน้ารวมคลิป", exact: true })).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await watchBackLink.click();
  await page.waitForURL(/\/$/);
});

test("admin sidebar stays sticky on a long page (1280); the mobile topbar/drawer are unchanged (390)", async ({ page }) => {
  // 18+ real users (page size is 20) so /admin/users page 1 is genuinely taller than the viewport.
  const video = await findVideoByYoutubeId(new UserSession(page.request), BRIEF_VIDEO_YOUTUBE_ID);
  for (let i = 0; i < 18; i++) {
    await createSession(new UserSession(page.request), video.id);
  }

  await adminLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.setViewportSize(DESKTOP);
  await page.goto("/admin/users");

  const logoutButton = page.getByRole("button", { name: "ออกจากระบบ" });
  const dashboardLink = page.getByRole("link", { name: "แดชบอร์ด" });
  await expect(logoutButton).toBeVisible();
  await expect(dashboardLink).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolledY = await page.evaluate(() => window.scrollY);
  expect(scrolledY, "sanity: the page must have actually needed to scroll (18+ users makes the list tall enough)").toBeGreaterThan(0);

  await expect(logoutButton, "the sidebar's logout button must still be in the viewport after scrolling a long list").toBeInViewport();
  await expect(dashboardLink, "the sidebar nav must still be in the viewport after scrolling a long list").toBeInViewport();

  // 390: mobile topbar/drawer behaviour must be unchanged by the sticky-sidebar fix.
  await page.setViewportSize(MOBILE);
  await page.reload();
  await expect(page.locator(".admin-topbar")).toBeVisible();
  await expect(page.locator(".admin-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "เปิดเมนู" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
