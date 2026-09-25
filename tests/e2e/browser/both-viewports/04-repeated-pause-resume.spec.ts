// Planner-requested regression case for fix/pause-resume-guard (WatchTracker.notePaused()):
// YouTube's own ~0.27s pause-settle lag used to leave the client anti-cheat tracker's high-water
// mark stranded behind the real position, so resuming ~1.5s later looked like a backward-then-
// forward cheat jump — a false-positive resync toast on every honest pause/resume. This repeats
// the cycle 3× to make sure the fix holds, not just on the first pause.
import { expect, test } from "@playwright/test";
import { exposeYouTubePlayerOnWindow, getPlayerCurrentTime, waitForWindowPlayer } from "../helpers/player";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(90_000);

test("play 3s → pause → wait 2s → play, repeated 3×: no resync toast, no backward jump", async ({ page }) => {
  await exposeYouTubePlayerOnWindow(page);

  await page.goto("/");
  await page.locator("a.featured-card").click();
  await page.waitForURL(/\/watch\//);
  await waitForWindowPlayer(page);

  const resyncToast = page.getByText("ข้ามช่วงวิดีโอไม่ได้นะคะ");

  let positionBeforeThisCycle = 0;
  for (let cycle = 1; cycle <= 3; cycle++) {
    await clickPlayPause(page); // Play
    await page.waitForTimeout(3_000);
    const positionAfterPlaying = await getPlayerCurrentTime(page);
    expect(positionAfterPlaying, `cycle ${cycle}: playback must advance from where it left off`).toBeGreaterThanOrEqual(positionBeforeThisCycle);

    await clickPlayPause(page, "หยุดชั่วคราว"); // Pause
    // Let YouTube's own pause-settle lag fully resolve before the next resume — this window is
    // exactly what triggered the false positive pre-fix.
    await page.waitForTimeout(2_000);

    await expect(resyncToast, `cycle ${cycle}: an honest pause must never trigger the resync toast`).not.toBeVisible();
    positionBeforeThisCycle = await getPlayerCurrentTime(page);
  }

  // One more resume past the loop, to also cover the exact "resume after the last pause" moment.
  await clickPlayPause(page);
  await page.waitForTimeout(1_500);
  const finalPosition = await getPlayerCurrentTime(page);
  expect(finalPosition, "the final resume must not snap the player backward").toBeGreaterThanOrEqual(positionBeforeThisCycle - 1);
  await expect(resyncToast, "the final resume must not trigger the resync toast either").not.toBeVisible();
});
