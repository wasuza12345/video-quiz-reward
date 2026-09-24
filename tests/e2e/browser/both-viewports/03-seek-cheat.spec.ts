// P6b flow 4 — cheating via the player directly (`player.seekTo(40)`, as a devtools/console
// attack would): the client's rAF seek guard (watch-tracker-core.ts) snaps it back to the local
// high-water mark on the very next frame and shows the resync toast — no server round trip
// needed for this to be caught — and there is no reward.
import { expect, test } from "@playwright/test";
import { exposeYouTubePlayerOnWindow, getPlayerCurrentTime, seekPlayerTo, waitForWindowPlayer } from "../helpers/player";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(60_000);

test("player.seekTo(40) from the console snaps back and earns nothing", async ({ page }) => {
  await exposeYouTubePlayerOnWindow(page);

  await page.goto("/");
  await page.locator("a.featured-card").click();
  await page.waitForURL(/\/watch\//);
  await waitForWindowPlayer(page);

  await clickPlayPause(page);
  await page.waitForTimeout(2_500);
  const beforeCheat = await getPlayerCurrentTime(page);
  expect(beforeCheat, "expected a few real seconds of honest playback before the cheat attempt").toBeGreaterThan(0);

  await seekPlayerTo(page, 40, true);

  await expect(page.getByText("ข้ามช่วงวิดีโอไม่ได้นะคะ"), "the resync toast must fire").toBeVisible({ timeout: 5_000 });

  await page.waitForTimeout(1_000);
  const afterSnapBack = await getPlayerCurrentTime(page);
  expect(afterSnapBack, "the player must be snapped back near the pre-cheat position, not left at 40s").toBeLessThan(15);

  await expect(page.getByText(/\+\d+\s*Points/), "a rejected forward jump must never be rewarded").not.toBeVisible();
});
