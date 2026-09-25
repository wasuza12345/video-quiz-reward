// Standalone hands-on admin audit script (not part of the E2E suite) — walks every admin screen,
// screenshots at 1280px and 390px, logs console/pageerror/dev-overlay signals, and cross-checks
// dashboard numbers against the DB directly. Run with: npx tsx audit.ts
//
// Runs against `next dev` (not the prod build the rest of the E2E suite uses) specifically to
// also catch Next's dev-overlay. That means every fresh route needs a hydration wait after
// page.goto/reload — Turbopack dev compiles a route lazily on first visit, and a click that lands
// before React attaches its onSubmit/onClick handler falls through to a native, unhandled form
// submission (a GET back to the same URL) instead of the real client behavior. `nav()`/`reloadReady()`
// below exist specifically to avoid that trap; never call page.goto/page.reload directly in here.
/* eslint-disable no-console */
import { chromium, type Page, type ConsoleMessage } from "@playwright/test";
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3199";
const ADMIN_EMAIL = "admin@e2e.local";
const ADMIN_PASSWORD = "e2e-only-password-123456";
const SCREENSHOT_DIR = path.resolve(__dirname, "audit-screenshots");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const db = createClient({ url: "file:./e2e.db" });

type LogEntry = { ts: string; label: string; kind: "console" | "pageerror" | "note"; text: string };
const consoleLog: LogEntry[] = [];

function attachConsoleCapture(page: Page, label: string) {
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" || m.type() === "warning") {
      consoleLog.push({ ts: new Date().toISOString(), label, kind: "console", text: `[${m.type()}] ${m.text()}` });
    }
  });
  page.on("pageerror", (e) => {
    consoleLog.push({ ts: new Date().toISOString(), label, kind: "pageerror", text: e.message });
  });
}

async function nav(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(4_000); // hydration buffer — see file header
}

async function reloadReady(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(4_000);
}

let shotCounter = 0;
async function shot(page: Page, name: string): Promise<string> {
  shotCounter += 1;
  const file = `${String(shotCounter).padStart(3, "0")}-${name}.png`;
  const full = path.join(SCREENSHOT_DIR, file);
  await page.screenshot({ path: full, fullPage: true });
  return `audit-screenshots/${file}`;
}

// `nextjs-portal` is ALWAYS present in dev mode (it also hosts the small persistent dev-tools
// corner badge), so its mere presence isn't a signal. A genuine error overlay renders a
// near-full-viewport dialog inside it — check for that specifically, not just the custom element.
async function hasDevErrorOverlay(page: Page): Promise<boolean> {
  const portal = page.locator("nextjs-portal");
  if ((await portal.count()) === 0) return false;
  const dialog = portal.locator("[role='dialog'], [data-nextjs-dialog], [data-nextjs-toast]").first();
  return (await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false));
}

interface Finding {
  screen: string;
  note: string;
  screenshot?: string;
}
const findings: Finding[] = [];
function note(screen: string, text: string, screenshot?: string) {
  findings.push({ screen, note: text, screenshot });
  console.log(`[NOTE] ${screen}: ${text}${screenshot ? ` (${screenshot})` : ""}`);
}

function persist() {
  fs.writeFileSync(path.join(SCREENSHOT_DIR, "..", "audit-findings.json"), JSON.stringify(findings, null, 2));
  fs.writeFileSync(path.join(SCREENSHOT_DIR, "..", "audit-console.json"), JSON.stringify(consoleLog, null, 2));
}

/** Fills + submits the login form and explicitly verifies the outcome — never assume. */
async function attemptLogin(page: Page, email: string, password: string): Promise<{ ok: boolean; url: string; errorText: string | null }> {
  await page.locator("#admin-email").fill(email);
  await page.locator("#admin-password").fill(password);
  const loginResponse = page.waitForResponse((r) => r.url().includes("/api/admin/auth/login"), { timeout: 10_000 }).catch(() => null);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  const res = await loginResponse;
  if (!res) {
    note("login", "no /api/admin/auth/login response observed within 10s after clicking submit — click may not have reached the handler");
  } else {
    note("login", `POST /api/admin/auth/login -> ${res.status()}`);
  }
  if (res && res.status() === 200) {
    // A 200 means the server accepted it — the client still needs to router.push("/admin") after,
    // which is a separate async step (AdminLoginPage.tsx). Wait for that explicitly instead of a
    // fixed delay, so a slow-but-real redirect isn't misread as a failure.
    await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 8_000 }).catch(() => {});
  } else {
    await page.waitForTimeout(500);
  }
  const url = page.url();
  const errorEl = page.getByText(/ไม่ถูกต้อง|หลายครั้งเกินไป|เชื่อมต่อระบบไม่ได้/).first();
  const errorText = (await errorEl.count()) ? await errorEl.textContent() : null;
  const ok = /\/admin(\?.*)?$/.test(url) && !/\/admin\/login/.test(url);
  return { ok, url, errorText };
}

async function main() {
  const browser = await chromium.launch();

  // ---------- DESKTOP PASS (1280x800) — full walkthrough ----------
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE_URL });
  const page = await desktopCtx.newPage();
  attachConsoleCapture(page, "desktop");

  // ---- Login screen ----
  await nav(page, `${BASE_URL}/admin/login`);
  note("login", "initial screenshot", await shot(page, "login-empty"));

  const wrong1 = await attemptLogin(page, ADMIN_EMAIL, "definitely-wrong-password");
  note("login", `after 1 wrong password attempt: ok=${wrong1.ok} url=${wrong1.url} errorText=${wrong1.errorText}`, await shot(page, "login-wrong-1"));

  // 5 more wrong attempts to trip the IP lockout (IP_FAIL_LIMIT=5, blocks starting the 6th).
  let lockoutSeen: { ok: boolean; url: string; errorText: string | null } | null = null;
  for (let i = 2; i <= 6; i++) {
    lockoutSeen = await attemptLogin(page, ADMIN_EMAIL, `definitely-wrong-password-${i}`);
  }
  note("login", `after 6 wrong password attempts: ok=${lockoutSeen?.ok} url=${lockoutSeen?.url} errorText=${lockoutSeen?.errorText}`, await shot(page, "login-lockout"));

  // Try the CORRECT password while still locked — should still be rejected (throttle checked
  // before password verification).
  const correctWhileLocked = await attemptLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  note(
    "login",
    `correct password while IP-locked: ok=${correctWhileLocked.ok} url=${correctWhileLocked.url} errorText=${correctWhileLocked.errorText} (expect ok=false)`,
    await shot(page, "login-locked-correct-pw"),
  );

  // Clear BOTH throttle keys directly (audit env only — see login-throttle.ts: one row keyed on
  // (email, ip), one keyed on email alone) so we can proceed with the walkthrough.
  await db.execute("DELETE FROM LoginThrottle");
  await reloadReady(page);
  const success = await attemptLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  note("login", `correct password after throttle cleared: ok=${success.ok} url=${success.url} errorText=${success.errorText}`, await shot(page, "login-success"));

  if (!success.ok) {
    note("login", "BLOCKED: could not establish an admin session — aborting the rest of the walkthrough that needs auth. Findings so far are still valid.");
    persist();
    await browser.close();
    return;
  }

  // ---- Dashboard (empty-ish: 1 seeded video, 0 users, 0 sessions) ----
  await nav(page, `${BASE_URL}/admin`);
  note("dashboard", "initial state (1 video, 0 users, 0 sessions expected)", await shot(page, "dashboard-empty"));

  const dbCounts = {
    videos: (await db.execute("SELECT COUNT(*) c FROM Video")).rows[0].c,
    users: (await db.execute("SELECT COUNT(*) c FROM User")).rows[0].c,
    sessions: (await db.execute("SELECT COUNT(*) c FROM WatchSession")).rows[0].c,
    flagged: (await db.execute("SELECT COUNT(*) c FROM WatchSession WHERE flagged = 1")).rows[0].c,
  };
  note("dashboard", `DB truth at empty state: ${JSON.stringify(dbCounts)}`);

  const viewAllLink = page.getByRole("link", { name: /ดูทั้งหมด/ }).first();
  if (await viewAllLink.count()) {
    const href = await viewAllLink.getAttribute("href");
    note("dashboard", `"ดูทั้งหมด" link present, href=${href}`);
  } else {
    note("dashboard", `"ดูทั้งหมด" link NOT found at empty state`);
  }

  // ---- Videos: list (1 seeded video), near-empty state via direct DB archive ----
  await nav(page, `${BASE_URL}/admin/videos`);
  note("videos-list", "with 1 seeded video", await shot(page, "videos-list-1item"));

  await db.execute("UPDATE Video SET status = 'archived' WHERE youtubeId = 'X7K_Xlz3T1Y'");
  await reloadReady(page);
  note("videos-list", "after archiving the only video (checking near-empty/archived-filter state)", await shot(page, "videos-list-archived"));
  await db.execute("UPDATE Video SET status = 'published' WHERE youtubeId = 'X7K_Xlz3T1Y'");
  await reloadReady(page);

  // ---- Create a video from a YouTube URL ----
  await nav(page, `${BASE_URL}/admin/videos/new`);
  note("videos-new", "empty create form", await shot(page, "videos-new-empty"));

  const LONG_THAI_TITLE =
    "วิดีโอทดสอบชื่อยาวมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมากมาก เพื่อทดสอบการตัดคำและ overflow ในตารางและฟอร์ม";

  let createdVideoId = "";
  try {
    await page.getByLabel("ลิงก์ YouTube").fill("https://youtu.be/jNQXAC9IVRw", { timeout: 15_000 });
    await page.waitForTimeout(2_500); // preview + duration poll — generous, to rule out a script-timing race
    const urlErrorAfterFill = await page
      .getByText("ลิงก์ YouTube ไม่ถูกต้อง")
      .isVisible()
      .catch(() => false);
    note("videos-new", `"invalid YouTube link" validation error visible right after filling a valid URL (before touching any other field): ${urlErrorAfterFill}`);
    await page.getByLabel("ชื่อคลิป").fill(LONG_THAI_TITLE);
    await page.waitForTimeout(500);
    const urlErrorAfterTitle = await page
      .getByText("ลิงก์ YouTube ไม่ถูกต้อง")
      .isVisible()
      .catch(() => false);
    note("videos-new", `same check after also filling the title field: ${urlErrorAfterTitle}`, await shot(page, "videos-new-long-title-filled"));

    if (urlErrorAfterFill || urlErrorAfterTitle) {
      // Re-click the URL field and retype without changing it, in case it's a stale debounced
      // validation result rather than a persistent block.
      const urlField = page.getByLabel("ลิงก์ YouTube");
      await urlField.click();
      await urlField.press("End");
      await urlField.press("Space");
      await urlField.press("Backspace");
      await page.waitForTimeout(1_500);
      const urlErrorAfterNudge = await page
        .getByText("ลิงก์ YouTube ไม่ถูกต้อง")
        .isVisible()
        .catch(() => false);
      note("videos-new", `same check after a no-op nudge (space+backspace) on the URL field: ${urlErrorAfterNudge}`, await shot(page, "videos-new-url-error-nudge-check"));
    }

    await page.getByRole("button", { name: "บันทึกและเพิ่มคำถาม" }).click();
    await page.waitForURL(/\/admin\/videos\/[0-9a-f-]{20,}$/, { timeout: 40_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    createdVideoId = page.url().split("/").pop() ?? "";
    note("videos-edit", "video edit page right after create (long title)", await shot(page, "videos-edit-long-title"));
  } catch (e) {
    note("videos-new", `create-video flow failed: ${e}`, await shot(page, "videos-new-error"));
  }

  if (createdVideoId) {
    // ---- Edit title/points/duration ----
    try {
      await page.getByLabel("ชื่อคลิป").fill("วิดีโอทดสอบชื่อสั้น");
      const pointsField = page.getByLabel(/แต้ม/);
      if (await pointsField.count()) {
        await pointsField.first().fill("25");
      } else {
        note("videos-edit", "could not find a points/reward field by label containing แต้ม");
      }
      note("videos-edit", "after editing title + points, before save", await shot(page, "videos-edit-fields-changed"));
      const saveBtn = page.getByRole("button", { name: /บันทึก/ }).first();
      await saveBtn.click();
      await page.waitForTimeout(1_000);
      note("videos-edit", "after saving edited fields", await shot(page, "videos-edit-saved"));
    } catch (e) {
      note("videos-edit", `edit fields flow failed: ${e}`, await shot(page, "videos-edit-error"));
    }

    // ---- Add a question using "ใช้เวลาปัจจุบัน" ----
    try {
      await page.waitForTimeout(1_000);
      const addQBtn = page.getByRole("button", { name: "+ เพิ่มคำถาม" });
      if (await addQBtn.count()) {
        await addQBtn.click();
        await page.getByLabel("คำถาม", { exact: true }).fill("คำถามทดสอบ audit?");
        await page.getByLabel("ข้อความตัวเลือก A").fill("ตัวเลือก A");
        await page.getByLabel("ข้อความตัวเลือก B").fill("ตัวเลือก B");
        const useCurrentTimeBtn = page.getByRole("button", { name: "ใช้เวลาปัจจุบัน" });
        note("videos-edit-question", "add-question form filled, before using ใช้เวลาปัจจุบัน", await shot(page, "question-form-filled"));
        const enabled = await useCurrentTimeBtn.isEnabled().catch(() => false);
        note("videos-edit-question", `"ใช้เวลาปัจจุบัน" enabled without ever pressing play on the preview: ${enabled}`);
        if (enabled) {
          await useCurrentTimeBtn.click();
          note("videos-edit-question", "after clicking ใช้เวลาปัจจุบัน", await shot(page, "question-use-current-time"));
        }
        const saveQBtn = page.getByRole("button", { name: "บันทึกคำถาม" });
        await saveQBtn.click();
        await page.waitForTimeout(800);
        note("videos-edit-question", "after saving the question", await shot(page, "question-saved"));
      } else {
        note("videos-edit-question", "could not find + เพิ่มคำถาม button");
      }
    } catch (e) {
      note("videos-edit-question", `add-question flow failed: ${e}`, await shot(page, "question-error"));
    }

    // ---- Publish, then feature ----
    try {
      const publishBtn = page.getByRole("button", { name: "เผยแพร่" });
      if (await publishBtn.count()) {
        await publishBtn.click();
        await page.waitForTimeout(500);
        note("videos-edit", "after publish", await shot(page, "video-published"));
      } else {
        note("videos-edit", "publish button not found (maybe already published)");
      }
    } catch (e) {
      note("videos-edit", `publish flow failed: ${e}`);
    }

    // ---- Public homepage check ----
    await nav(page, `${BASE_URL}/`);
    note("public-home", "after admin actions above", await shot(page, "public-home-check"));

    // ---- Deliberate repro: creating a video with a YouTube URL already in the system ----
    try {
      await nav(page, `${BASE_URL}/admin/videos/new`);
      await page.getByLabel("ลิงก์ YouTube").fill("https://youtu.be/jNQXAC9IVRw", { timeout: 15_000 });
      await page.waitForTimeout(1_500);
      await page.getByLabel("ชื่อคลิป").fill("ทดสอบซ้ำ audit");
      await page.getByRole("button", { name: "บันทึกและเพิ่มคำถาม" }).click();
      await page.waitForTimeout(2_000);
      const dupError = page.getByText("ลิงก์ YouTube ไม่ถูกต้อง");
      const dupErrorVisible = await dupError.isVisible().catch(() => false);
      note(
        "videos-new-duplicate",
        `submitting a YouTube URL that's already in the system shows: "${dupErrorVisible ? await dupError.textContent() : "(no error text found)"}" — server actually sends "this video has already been added" (video.service.ts:159) but the client always maps any youtubeUrl validation issue to the generic "invalid link" copy (AdminVideoFormPage.tsx:149), discarding the specific message`,
        await shot(page, "videos-new-duplicate-error"),
      );
    } catch (e) {
      note("videos-new-duplicate", `duplicate-video repro flow failed: ${e}`);
    }

    await nav(page, `${BASE_URL}/admin/videos/${createdVideoId}`);

    // ---- Delete the test question (cleanup + exercise delete flow) ----
    try {
      const deleteQBtn = page.getByRole("button", { name: "ลบคำถาม" });
      if (await deleteQBtn.count()) {
        await deleteQBtn.first().click();
        await page.waitForTimeout(300);
        note("videos-edit-question", "delete-question confirm state", await shot(page, "question-delete-confirm"));
        const confirmBtn = page.getByRole("button", { name: /ยืนยัน|ลบ/ }).last();
        if (await confirmBtn.count()) await confirmBtn.click();
        await page.waitForTimeout(500);
        note("videos-edit-question", "after confirming delete", await shot(page, "question-deleted"));
      }
    } catch (e) {
      note("videos-edit-question", `delete-question flow failed: ${e}`);
    }
  } else {
    note("videos-new", "skipping edit/question/publish/feature — video creation failed above");
  }

  // ---- Manufacture users/sessions via real HTTP (public API), for Users/Sessions screens ----
  let briefVideoId = "";
  let sessAId = "";
  let sessBId = "";
  try {
    const apiModule = await import("./tests/e2e/helpers/api");
    const { UserSession, findVideoByYoutubeId, createSession, postEvents, postAnswer, claim, playHonestlyTo } = apiModule;

    const briefVideoUser = new UserSession(page.request as never);
    const briefVideo = await findVideoByYoutubeId(briefVideoUser as never, "X7K_Xlz3T1Y");
    briefVideoId = briefVideo.id;

    // User A: honest full watch + reward. Real-time-paced TICKs (playHonestlyTo, same helper the
    // API-level E2E suite uses) — a burst of TICKs with no elapsed wall-clock time between them
    // gets rejected by the anti-cheat token bucket and never actually reaches the quiz trigger.
    const userA = new UserSession(page.request as never);
    const sessA = await createSession(userA as never, briefVideo.id);
    const sessABody = (await sessA.json()) as { sessionId: string; quizzes: Array<{ id: string; triggerSec: number }> };
    sessAId = sessABody.sessionId;
    const questionId = sessABody.quizzes[0]?.id;
    await postEvents(userA as never, sessAId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
    const toGate = await playHonestlyTo(userA as never, sessAId, { fromSeq: 2, fromPositionSec: 0, toPositionSec: 13 });
    if (questionId && toGate.lastBody.currentQuestionId === questionId) {
      await postAnswer(userA as never, sessAId, questionId, "D").catch((e) => note("data-setup", `postAnswer failed: ${e}`));
      await postEvents(userA as never, sessAId, [{ seq: toGate.nextSeq, type: "PLAY", positionSec: 13 }]);
      const toEnd = await playHonestlyTo(userA as never, sessAId, { fromSeq: toGate.nextSeq + 1, fromPositionSec: 13, toPositionSec: 44 });
      await postEvents(userA as never, sessAId, [{ seq: toEnd.nextSeq, type: "ENDED", positionSec: 44 }]);
      await claim(userA as never, sessAId).catch((e) => note("data-setup", `claim failed: ${e}`));
    } else {
      note("data-setup", `userA: quiz gate not reached as expected (state=${toGate.lastBody.state}, currentQuestionId=${toGate.lastBody.currentQuestionId})`);
    }

    // User B: flagged/rejected session (forward seek).
    const userB = new UserSession(page.request as never);
    const sessB = await createSession(userB as never, briefVideo.id);
    sessBId = ((await sessB.json()) as { sessionId: string }).sessionId;
    await postEvents(userB as never, sessBId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);
    await postEvents(userB as never, sessBId, [{ seq: 2, type: "TICK", positionSec: 20 }]);

    // User C: in-progress, never finished.
    const userC = new UserSession(page.request as never);
    const sessC = await createSession(userC as never, briefVideo.id);
    await postEvents(userC as never, ((await sessC.json()) as { sessionId: string }).sessionId, [{ seq: 1, type: "PLAY", positionSec: 0 }]);

    // Several more users, for pagination.
    for (let i = 0; i < 15; i++) {
      const u = new UserSession(page.request as never);
      await createSession(u as never, briefVideo.id);
    }

    note("data-setup", `manufactured sessions: honest=${sessAId} flagged=${sessBId}, plus ~17 more users for pagination`);
  } catch (e) {
    note("data-setup", `manufacturing users/sessions failed: ${e}`);
  }

  // ---- Dashboard again, now with real data ----
  await nav(page, `${BASE_URL}/admin`);
  note("dashboard", "after manufacturing users/sessions", await shot(page, "dashboard-with-data"));
  const dbCounts2 = {
    videos: (await db.execute("SELECT COUNT(*) c FROM Video")).rows[0].c,
    users: (await db.execute("SELECT COUNT(*) c FROM User")).rows[0].c,
    sessions: (await db.execute("SELECT COUNT(*) c FROM WatchSession")).rows[0].c,
    flagged: (await db.execute("SELECT COUNT(*) c FROM WatchSession WHERE flagged = 1")).rows[0].c,
    rewarded: (await db.execute("SELECT COUNT(*) c FROM PointsLedger")).rows[0].c,
  };
  note("dashboard", `DB truth with data: ${JSON.stringify(dbCounts2)}`);

  const videoFilterSelect = page.locator("select").first();
  if (await videoFilterSelect.count()) {
    await videoFilterSelect.selectOption({ index: 1 }).catch(() => {});
    await page.waitForTimeout(500);
    note("dashboard", "after applying video filter", await shot(page, "dashboard-video-filter"));
  } else {
    note("dashboard", "no <select> found for the video filter — may use a different control");
  }

  const viewAllLink2 = page.getByRole("link", { name: /ดูทั้งหมด/ }).first();
  if (await viewAllLink2.count()) {
    await viewAllLink2.click();
    await page.waitForTimeout(500);
    note("dashboard", "after clicking ดูทั้งหมด", await shot(page, "dashboard-view-all-clicked"));
  }

  // ---- Users: list, paging, detail ----
  await nav(page, `${BASE_URL}/admin/users`);
  note("users-list", "list with ~18 users", await shot(page, "users-list"));
  const nextPageBtn = page.getByRole("link", { name: /ถัดไป|Next|»/ }).or(page.getByRole("button", { name: /ถัดไป|Next|»/ }));
  if (await nextPageBtn.count()) {
    await nextPageBtn.first().click();
    await page.waitForTimeout(500);
    note("users-list", "page 2", await shot(page, "users-list-page2"));
  } else {
    note("users-list", "no next-page control found (may not paginate at this count, or uses different labels)");
  }
  const firstUserLink = page.locator("table a, ul a").first();
  if (await firstUserLink.count()) {
    await firstUserLink.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2_000); // first visit to a not-yet-compiled dynamic route
    note("users-detail", "first user's detail page", await shot(page, "users-detail"));
  }

  // ---- Sessions: list, filters, detail timeline ----
  await nav(page, `${BASE_URL}/admin/sessions`);
  note("sessions-list", "list with mixed session states", await shot(page, "sessions-list"));

  const flaggedFilterCheckbox = page.getByLabel(/แจ้งเตือน/);
  if (await flaggedFilterCheckbox.count()) {
    await flaggedFilterCheckbox.click();
    await page.waitForTimeout(500);
    note("sessions-list", "flagged filter applied", await shot(page, "sessions-list-flagged-filter"));
    if (sessBId) {
      // Direct nav by the known id, not a link click — a generic "first link on the page"
      // locator turned out to match the sidebar nav (e.g. "แดชบอร์ด") rather than the row, since
      // both satisfy "6+ non-whitespace chars". Same direct-nav pattern the E2E suite's
      // 02-admin.spec.ts uses for exactly this reason.
      await nav(page, `${BASE_URL}/admin/sessions/${sessBId}`);
      note("sessions-detail", "flagged session detail (reject chip + flag badge expected)", await shot(page, "sessions-detail-flagged"));
    } else {
      note("sessions-list", "no manufactured flagged session id available to open");
    }
  }

  if (briefVideoId) {
    await nav(page, `${BASE_URL}/admin/sessions?videoId=${briefVideoId}`);
    const rewardedRow = page.locator("tr", { hasText: "ดูจบ" }).first();
    if (await rewardedRow.count()) {
      await rewardedRow.getByRole("link").first().click();
      await page.waitForTimeout(500);
      note("sessions-detail", "honestly-completed session detail (TICK grouping, ANSWER/CLAIM expected)", await shot(page, "sessions-detail-honest"));
      const collapsedGroup = page.getByRole("button", { name: /ความคืบหน้า ×/ }).first();
      if (await collapsedGroup.count()) {
        await collapsedGroup.click();
        await page.waitForTimeout(300);
        note("sessions-detail", "TICK group expanded", await shot(page, "sessions-detail-honest-expanded"));
      }
    } else {
      note("sessions-list", "could not find an honestly-completed (ดูจบ) row to open");
    }
  }

  // ---- Locked fields on the brief video (has sessions now) ----
  await nav(page, `${BASE_URL}/admin/videos`);
  const briefLink = page.getByRole("link", { name: /ตัวอย่างคลิป/ }).first();
  if (await briefLink.count()) {
    await briefLink.click();
    await page.waitForTimeout(500);
    note("videos-edit-locked", "brief video edit page (should show lock notice, has sessions)", await shot(page, "video-locked"));
  }

  // ---- Error state: simulate API down ----
  await page.route("**/api/admin/**", (route) => route.abort("failed"));
  await nav(page, `${BASE_URL}/admin`);
  note("error-state", "dashboard with all /api/admin/* calls aborted", await shot(page, "error-state-dashboard"));
  await nav(page, `${BASE_URL}/admin/videos`);
  note("error-state", "videos list with API down", await shot(page, "error-state-videos"));
  await page.unroute("**/api/admin/**");

  const overlayDesktop = await hasDevErrorOverlay(page);
  note("dev-overlay", `Next dev overlay present at end of desktop pass: ${overlayDesktop}`);

  // ---- Logout ----
  await nav(page, `${BASE_URL}/admin`);
  const logoutBtn = page.getByRole("button", { name: "ออกจากระบบ" });
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await page.waitForTimeout(500);
    note("logout", "after logout", await shot(page, "logout-done"));
    await nav(page, `${BASE_URL}/admin`);
    note("logout", "visiting /admin again after logout (should redirect to login)", await shot(page, "logout-redirect-check"));
  }

  await desktopCtx.close();
  persist();

  // ---- MOBILE PASS (390x844) — revisit key screens for layout/rendering ----
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mobileCtx.newPage();
  attachConsoleCapture(mpage, "mobile");

  await nav(mpage, `${BASE_URL}/admin/login`);
  const mobileLogin = await attemptLogin(mpage, ADMIN_EMAIL, ADMIN_PASSWORD);
  note("mobile-login", `login at 390px: ok=${mobileLogin.ok}`, await shot(mpage, "mobile-login"));

  if (mobileLogin.ok) {
    await nav(mpage, `${BASE_URL}/admin`);
    note("mobile-dashboard", "dashboard at 390px", await shot(mpage, "mobile-dashboard"));

    await nav(mpage, `${BASE_URL}/admin/videos`);
    note("mobile-videos", "videos list at 390px", await shot(mpage, "mobile-videos-list"));

    if (createdVideoId) {
      await nav(mpage, `${BASE_URL}/admin/videos/${createdVideoId}`);
      note("mobile-videos-edit", "video edit at 390px (long-title case)", await shot(mpage, "mobile-video-edit"));
    }

    await nav(mpage, `${BASE_URL}/admin/users`);
    note("mobile-users", "users list at 390px", await shot(mpage, "mobile-users-list"));

    await nav(mpage, `${BASE_URL}/admin/sessions`);
    note("mobile-sessions", "sessions list at 390px", await shot(mpage, "mobile-sessions-list"));

    const mobileRewardedRow = mpage.locator("li, tr", { hasText: "ดูจบ" }).first();
    if (await mobileRewardedRow.count()) {
      await mobileRewardedRow.getByRole("link").first().click().catch(() => {});
      await mpage.waitForTimeout(500);
      note("mobile-sessions-detail", "session detail timeline at 390px", await shot(mpage, "mobile-session-detail"));
    }

    await nav(mpage, `${BASE_URL}/admin/videos/new`);
    note("mobile-videos-new", "create-video form at 390px", await shot(mpage, "mobile-video-new"));
  } else {
    note("mobile-login", "mobile login failed — skipping rest of mobile pass");
  }

  const overlayMobile = await hasDevErrorOverlay(mpage);
  note("dev-overlay", `Next dev overlay present at end of mobile pass: ${overlayMobile}`);

  await mobileCtx.close();
  await browser.close();
  persist();
  console.log(`\nDone. ${findings.length} notes, ${consoleLog.length} console/pageerror entries.`);
}

main()
  .catch((e) => {
    console.error("AUDIT SCRIPT FAILED:", e);
    note("script", `unhandled failure: ${e}`);
  })
  .finally(() => {
    persist();
    db.close();
  });
