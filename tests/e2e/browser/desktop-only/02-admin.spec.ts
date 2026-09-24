// P6b flow 5 (admin CRUD + timeline) and flow 6 (logout). Desktop-only — the admin panel is a
// data-table-heavy backoffice; the mobile-vs-desktop CSS pairing is exercised lightly by the
// AdminShell nav (both markups always render, CSS toggles which is visible), not by this flow's
// business logic, so duplicating the ~real-video-touching parts at 390×844 wouldn't add much.
import { expect, test, type Page } from "@playwright/test";
import { adminLogin } from "../helpers/admin";
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TEST_VIDEO_YOUTUBE_ID, BRIEF_QUESTION_TRIGGER_SEC, BRIEF_VIDEO_YOUTUBE_ID } from "../helpers/env";
import { exposeYouTubePlayerOnWindow, seekPlayerTo, waitForPlayerDuration, waitForWindowPlayer } from "../helpers/player";

test.setTimeout(120_000);

test("admin login: wrong password shows an error, correct password reaches the dashboard", async ({ page }) => {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(ADMIN_EMAIL);
  await page.locator("#admin-password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByRole("alert")).toContainText("อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ");

  await page.locator("#admin-password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 15_000 });
  await expect(page.getByText("แดชบอร์ด").first()).toBeVisible();
});

function choiceTextInput(page: Page, label: string) {
  // The choice row has no id/name on its text input (VideoForm-style plain inputs) — go up from
  // the radio (whose aria-label IS stable: "เฉลย {label}") to the row div, then find the sibling
  // input that isn't the radio itself (QuizEditor.tsx: <label><input radio/></label><span/><input/>).
  return page.locator(`input[aria-label="เฉลย ${label}"]`).locator("xpath=../..").locator('input:not([type="radio"])');
}

test("create video → publish → feature → shows on / → session timeline → locked fields → logout", async ({ page }) => {
  await exposeYouTubePlayerOnWindow(page);
  await adminLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const videoTitle = `P6b admin test ${Date.now()}`;

  await test.step("create a video from a YouTube URL", async () => {
    await page.goto("/admin/videos/new");
    await waitForWindowPlayer(page);
    await waitForPlayerDuration(page); // the admin preview player reports durationSec (plan §7)

    await page.locator('label:text-is("ลิงก์ YouTube") + input').fill(`https://youtu.be/${ADMIN_TEST_VIDEO_YOUTUBE_ID}`);
    await waitForPlayerDuration(page); // re-fires: the preview player is rebuilt for the new link
    await page.locator('label:text-is("ชื่อคลิป") + input').fill(videoTitle);

    await page.getByRole("button", { name: "บันทึกและเพิ่มคำถาม" }).click();
    await page.waitForURL(/\/admin\/videos\/[^/]+$/, { timeout: 20_000 });
  });

  await test.step('add a question using "ใช้เวลาปัจจุบัน"', async () => {
    await waitForWindowPlayer(page); // a fresh preview-player instance on the edit page
    await seekPlayerTo(page, 5, true);
    await page.waitForTimeout(800);

    await page.getByRole("button", { name: "+ เพิ่มคำถาม" }).click();
    await page.locator("textarea").fill("Test question?");
    await choiceTextInput(page, "A").fill("Choice A");
    await choiceTextInput(page, "B").fill("Choice B");

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

  let briefVideoId = "";
  let flaggedSessionId = "";
  await test.step("manufacture a flagged/rejected session (real HTTP, via the page's own cookie) for the reject/flag timeline check", async () => {
    const videosBody = (await (await page.request.get("/api/videos")).json()) as {
      featured: { id: string; youtubeId: string } | null;
      videos: { id: string; youtubeId: string }[];
    };
    const brief = [videosBody.featured, ...videosBody.videos].find((v) => v?.youtubeId === BRIEF_VIDEO_YOUTUBE_ID);
    if (!brief) throw new Error(`brief video ${BRIEF_VIDEO_YOUTUBE_ID} not found via GET /api/videos`);
    briefVideoId = brief.id;

    const created = (await (await page.request.post("/api/sessions", { data: { videoId: brief.id } })).json()) as { sessionId: string };
    flaggedSessionId = created.sessionId;
    await page.request.post(`/api/sessions/${flaggedSessionId}/events`, { data: { events: [{ seq: 1, type: "PLAY", positionSec: 0 }] } });
    // furthestSec is still 0, so a TICK to 20 needs 20s — more than the 10s bank could ever hold
    // → a hard SEEK_FORWARD reject, flagged immediately (same rule the API-level suite exercises).
    await page.request.post(`/api/sessions/${flaggedSessionId}/events`, { data: { events: [{ seq: 2, type: "TICK", positionSec: 20 }] } });
  });

  await test.step("admin sessions: the flagged filter surfaces it, and the detail shows the reject chip + flag badge", async () => {
    await page.goto("/admin/sessions");
    await page.getByLabel("เฉพาะที่ถูกแจ้งเตือน 🚩").check();
    await page.waitForURL(/flagged=true/);
    await expect(page.getByRole("link", { name: /^\S{6,}/ }).first(), "the flagged list must not be empty").toBeVisible({ timeout: 10_000 });

    await page.goto(`/admin/sessions/${flaggedSessionId}`);
    await expect(page.getByText("ถูกแจ้งเตือน").first()).toBeVisible();
    await expect(page.getByText("SEEK_FORWARD")).toBeVisible();
    await expect(page.getByText("🚩 ทำให้ถูกแจ้งเตือน")).toBeVisible();
  });

  await test.step("admin sessions: an honestly-completed session shows TICK collapsing + ANSWER/CLAIM", async () => {
    const listBody = (await (
      await page.request.get(`/api/admin/sessions?videoId=${briefVideoId}&pageSize=50`)
    ).json()) as { items: { id: string; state: string; pointsAwarded: number; isReplay: boolean }[] };
    const rewarded = listBody.items.find((s) => s.state === "ENDED" && s.pointsAwarded > 0 && !s.isReplay);
    if (!rewarded) throw new Error("expected at least one honestly-completed & rewarded session on the brief video (from the honest-flow spec)");

    await page.goto(`/admin/sessions/${rewarded.id}`);
    const collapsedGroup = page.getByRole("button", { name: /ความคืบหน้า ×/ });
    await expect(collapsedGroup, "consecutive accepted TICKs must collapse into one group").toBeVisible({ timeout: 10_000 });
    const groupCountBefore = await page.locator("tr", { hasText: "ความคืบหน้า ×" }).count();

    await collapsedGroup.click();
    const groupCountAfter = await page.locator("tr", { hasText: "ความคืบหน้า" }).count();
    expect(groupCountAfter, "expanding the group must reveal more rows than the single collapsed summary row").toBeGreaterThan(groupCountBefore);

    await expect(page.locator("tr", { hasText: "ตอบ" }).first(), "the ANSWER row must summarize the choice + correctness").toBeVisible();
    await expect(page.locator("tr", { hasText: `+${rewarded.pointsAwarded}` }).first(), "the CLAIM row must summarize the points").toBeVisible();
  });

  await test.step("a locked video (the brief one, already watched) disables its locked fields", async () => {
    await page.goto("/admin/videos");
    await page.getByRole("link", { name: /ตัวอย่างคลิป/ }).click();
    await page.waitForURL(/\/admin\/videos\/[^/]+$/, { timeout: 10_000 });
    await expect(page.locator("#video-locked-notice"), "a video with sessions must show the lock notice").toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Where does the flower bloom/ }).click();
    await expect(page.getByRole("radio", { name: "เฉลย D" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "ใช้เวลาปัจจุบัน" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "ลบคำถาม" })).toBeDisabled();
    await expect(page.locator('label:text-is("ลิงก์ YouTube 🔒") + input')).toHaveAttribute("readonly", "");
  });

  await test.step("logout redirects to the login page, and /admin then requires logging in again", async () => {
    await page.getByRole("button", { name: "ออกจากระบบ" }).click();
    await page.waitForURL(/\/admin\/login\?reason=logout/, { timeout: 10_000 });
    await expect(page.getByText("ออกจากระบบเรียบร้อยแล้วค่ะ")).toBeVisible();

    await page.goto("/admin");
    await page.waitForURL(/\/admin\/login/, { timeout: 10_000 });
  });
});
