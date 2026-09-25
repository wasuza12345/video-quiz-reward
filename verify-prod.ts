/* eslint-disable no-console */
import { chromium } from "@playwright/test";

const BASE_URL = "http://localhost:3199";
const ADMIN_EMAIL = "admin@e2e.local";
const ADMIN_PASSWORD = "e2e-only-password-123456";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/admin/login`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("#admin-email").fill(ADMIN_EMAIL);
  await page.locator("#admin-password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 15_000 });
  console.log("login: ok");

  // ---- Finding 1: duplicate-video error message ----
  await page.goto(`${BASE_URL}/admin/videos/new`);
  await page.getByLabel("ลิงก์ YouTube").fill("https://youtu.be/X7K_Xlz3T1Y"); // same as the seeded brief video
  await page.waitForTimeout(1_500);
  await page.getByLabel("ชื่อคลิป").fill("prod verify duplicate");
  await page.getByRole("button", { name: "บันทึกและเพิ่มคำถาม" }).click();
  await page.waitForTimeout(2_000);
  const dupError = page.getByText(/ไม่ถูกต้อง|เพิ่มไปแล้ว|already/);
  const dupVisible = await dupError.isVisible().catch(() => false);
  console.log("FINDING 1 (duplicate-video message):", dupVisible ? await dupError.textContent() : "(no error text found)");

  // ---- Finding 2: locked field readOnly vs disabled ----
  // Manufacture a session on the brief video so it becomes locked, via real HTTP.
  const apiModule = await import("./tests/e2e/helpers/api");
  const { UserSession, findVideoByYoutubeId, createSession, postEvents } = apiModule;
  const user = new UserSession(page.request as never);
  const video = await findVideoByYoutubeId(user as never, "X7K_Xlz3T1Y");
  const sess = await createSession(user as never, video.id);
  const { sessionId } = (await sess.json()) as { sessionId: string };
  await postEvents(user as never, sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);

  await page.goto(`${BASE_URL}/admin/videos/${video.id}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1_000);
  const urlInput = page.getByLabel(/ลิงก์ YouTube/);
  const isDisabled = await urlInput.isDisabled().catch(() => false);
  const isReadOnly = await urlInput.getAttribute("readonly").then((v) => v !== null).catch(() => false);
  const ariaDisabled = await urlInput.getAttribute("aria-disabled").catch(() => null);
  console.log(`FINDING 2 (locked youtubeUrl field): disabled=${isDisabled} readOnly=${isReadOnly} aria-disabled=${ariaDisabled}`);

  await browser.close();
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exitCode = 1;
});
