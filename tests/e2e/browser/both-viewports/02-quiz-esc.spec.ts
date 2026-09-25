// The quiz dialog is non-dismissible: pressing Escape (even twice, which can force
// Chromium's CloseWatcher to fire a native `close` despite `preventDefault()` on the first —
// src/frontend/shared/ui/Modal.tsx) must not let the viewer skip the question.
import { expect, test } from "@playwright/test";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(90_000);

test("Esc (even twice) does not dismiss the quiz dialog", async ({ page }) => {
  await page.goto("/");
  await page.locator("a.featured-card").click();
  await page.waitForURL(/\/watch\//);
  await clickPlayPause(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog, "the quiz dialog must open at the trigger time").toBeVisible({ timeout: 60_000 });

  await page.keyboard.press("Escape");
  await expect(dialog, "a single Esc must not close the quiz dialog").toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog, "a second rapid Esc must not close the quiz dialog either").toBeVisible();

  // Still answerable after both Esc presses.
  await expect(page.getByRole("button", { name: /^ตัวเลือก A:/ })).toBeVisible();
});
