// Regression case: TAB_HIDDEN during the quiz auto-resume window used to silently kill the TICK
// loop, and ENDED_NOT_WATCHED recovery used to loop forever. Three wrong answers in a row before
// the correct one exercises the quiz retry UI and the
// anti-cheat resume path more than the single-wrong-answer honest-flow spec does, then still
// finishes honestly for the reward. Every POST /events is logged and asserted 0-rejected.
import { expect, test } from "@playwright/test";
import { collectEventResults } from "../helpers/events";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(180_000);

// prisma/seed.ts's brief question choices — never sent to the public client, so hardcoded (same
// convention as the API-level suite's helpers/env.ts). D is correct; A, B, C are wrong.
const WRONG_CHOICE_LABELS = ["A", "B", "C"];
const CORRECT_CHOICE_LABEL = "D";

test("wrong x3 → D → watch to the end → +50", async ({ page }) => {
  const eventLog = collectEventResults(page);

  await page.goto("/");
  const featured = page.locator("a.featured-card");
  await expect(featured, "the home page must show a featured video card").toBeVisible();
  await featured.click();

  await page.waitForURL(/\/watch\//);
  await clickPlayPause(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog, "the quiz dialog must open once the video reaches its trigger time").toBeVisible({ timeout: 60_000 });

  for (const label of WRONG_CHOICE_LABELS) {
    const wrongChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${label}:`) });
    await wrongChoice.click();
    await expect(page.getByText("ยังไม่ถูกนะคะ"), `choice ${label} must be rejected as wrong`).toBeVisible();
    await expect(wrongChoice, `choice ${label} must be disabled after being marked wrong`).toHaveAttribute("aria-disabled", "true");
    await expect(dialog, `the dialog must stay open after wrong choice ${label}`).toBeVisible();
  }

  // No assertion on the "ถูกต้องค่ะ!" feedback text itself (see 01-honest-flow.spec.ts's comment):
  // auto-resume dismisses the dialog only ~900ms after a correct answer, a race the dialog
  // actually closing below proves unambiguously instead.
  const correctChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${CORRECT_CHOICE_LABEL}:`) });
  await correctChoice.click();
  await expect(dialog, "the quiz dialog must close and playback resume after the correct answer").toBeHidden({ timeout: 5_000 });

  const rewardText = page.getByText(/\+\d+\s*Points/);
  await expect(rewardText, "the reward banner must show once the honest watch reaches the end and claims").toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("ยินดีด้วยค่ะ!")).toBeVisible();

  const pointsBadge = page.getByRole("status").filter({ hasText: "แต้ม" }).first();
  await expect(pointsBadge).toContainText("50");

  eventLog.dispose();
  const rejected = eventLog.results.filter((r) => !r.accepted);
  expect(rejected, `expected 0 rejected events over this run, got: ${JSON.stringify(rejected)}`).toHaveLength(0);
});
