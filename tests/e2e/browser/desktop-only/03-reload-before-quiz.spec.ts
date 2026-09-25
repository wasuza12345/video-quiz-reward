// Reload BEFORE the quiz trigger, not after — the honest-flow spec (01) never reloads, and the refresh spec
// (both-viewports/01-refresh.spec.ts) never reaches the quiz or the reward. This covers the gap:
// a resumed session must still be able to reach the quiz, answer correctly, finish, and get
// rewarded — proving the resume-seek path doesn't leave the player wedged for a *normal* forward
// flow, not just a plain re-pause.
import { expect, test } from "@playwright/test";
import { collectEventResults } from "../helpers/events";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(180_000);

const CORRECT_CHOICE_LABEL = "D";

test("reload before the quiz trigger: resume → Play → quiz → correct → full watch → +50", async ({ page }) => {
  const eventLog = collectEventResults(page);

  await page.goto("/");
  const featured = page.locator("a.featured-card");
  await expect(featured, "the home page must show a featured video card").toBeVisible();
  await featured.click();

  await page.waitForURL(/\/watch\/(.+)$/);
  const watchUrl = page.url();

  await clickPlayPause(page);
  await page.waitForTimeout(5_000); // well before the ~13s quiz trigger
  await clickPlayPause(page, "หยุดชั่วคราว");

  await page.goto(watchUrl);
  await expect(page.getByText(/ดูต่อจาก/), "the resumed-position banner must show after reload").toBeVisible({ timeout: 30_000 });

  await clickPlayPause(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog, "the quiz dialog must still open at its trigger time after a resume").toBeVisible({ timeout: 60_000 });

  const correctChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${CORRECT_CHOICE_LABEL}:`) });
  await correctChoice.click();
  await expect(dialog, "the quiz dialog must close and playback resume after a correct answer").toBeHidden({ timeout: 5_000 });

  const rewardText = page.getByText(/\+\d+\s*Points/);
  await expect(rewardText, "the reward banner must show once the resumed, honest watch reaches the end and claims").toBeVisible({ timeout: 60_000 });

  const pointsBadge = page.getByRole("status").filter({ hasText: "แต้ม" }).first();
  await expect(pointsBadge).toContainText("50");

  eventLog.dispose();
  const rejected = eventLog.results.filter((r) => !r.accepted);
  expect(rejected, `expected 0 rejected events over this resumed-then-honest run, got: ${JSON.stringify(rejected)}`).toHaveLength(0);
});
