// P6b flow 1 — the honest flow through the REAL public UI, against the real embedded YouTube
// iframe (not the API-level suite's simulated ticks): open `/`, the featured card, Play, the
// quiz dialog opens at ~0:13, a wrong answer then the correct one, playback resumes and runs to
// the end, the reward banner + points badge show +50, and it survives a reload. Every
// POST /events the real client sends is logged and asserted 0-rejected.
//
// Real wall-clock: this decodes and plays an actual ~44s YouTube video end to end — there is no
// way to shortcut that and still prove the real client/player/anti-cheat wiring.
import { expect, test } from "@playwright/test";
import { collectEventResults } from "../helpers/events";

test.setTimeout(180_000);

// prisma/seed.ts's brief question — never sent to the public client, so the test hardcodes it
// (same convention as the API-level suite's helpers/env.ts).
const WRONG_CHOICE_LABEL = "A";
const CORRECT_CHOICE_LABEL = "D";

test("honest flow: featured card → quiz retry/correct → full watch → +50 → survives reload", async ({ page }) => {
  const eventLog = collectEventResults(page);

  await page.goto("/");
  const featured = page.locator("a.featured-card");
  await expect(featured, "the home page must show a featured video card").toBeVisible();
  await featured.click();

  await page.waitForURL(/\/watch\//);
  await expect(page.getByRole("button", { name: "เล่นวิดีโอ" }).first()).toBeEnabled({ timeout: 20_000 });

  await page.getByRole("button", { name: "เล่นวิดีโอ" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog, "the quiz dialog must open once the video reaches its trigger time").toBeVisible({ timeout: 45_000 });

  const wrongChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${WRONG_CHOICE_LABEL}:`) });
  await wrongChoice.click();
  await expect(page.getByText("ยังไม่ถูกนะคะ")).toBeVisible();
  await expect(wrongChoice).toHaveAttribute("aria-disabled", "true");

  const correctChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${CORRECT_CHOICE_LABEL}:`) });
  await correctChoice.click();
  await expect(page.getByText("ถูกต้องค่ะ!")).toBeVisible();

  // Auto-resume fires ~900ms after a correct answer (WatchPage.tsx).
  await expect(dialog, "the quiz dialog must close and playback resume after a correct answer").toBeHidden({ timeout: 5_000 });

  const rewardText = page.getByText(/\+\d+\s*Points/);
  await expect(rewardText, "the reward banner must show once the honest watch reaches the end and claims").toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("ยินดีด้วยค่ะ!")).toBeVisible();

  const pointsBadge = page.getByRole("status").filter({ hasText: "แต้ม" }).first();
  await expect(pointsBadge).toContainText("50");

  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "แต้ม" }).first(), "the point total must survive a reload").toContainText("50", { timeout: 15_000 });

  eventLog.dispose();
  const rejected = eventLog.results.filter((r) => !r.accepted);
  expect(rejected, `expected 0 rejected events over the honest run, got: ${JSON.stringify(rejected)}`).toHaveLength(0);
});
