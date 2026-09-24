// P6b flow 2 — refresh mid-video: reload at ~6s shows the resumed position, and the first TICK
// the client sends after pressing Play again is at/after that position (no regression back to 0).
import { expect, test, type Response } from "@playwright/test";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(90_000);
// Deterministic, not flaky (see the bug report sent to coder) — retrying just burns ~48s for the
// same result, so this file opts out of the suite's default retry.
test.describe.configure({ retries: 0 });

interface SessionBody {
  positionSec: number;
}

function captureFirstJson(page: import("@playwright/test").Page, match: (url: URL, method: string) => boolean): Promise<SessionBody> {
  return new Promise((resolve) => {
    const onResponse = async (response: Response) => {
      const req = response.request();
      if (!match(new URL(response.url()), req.method())) return;
      page.off("response", onResponse);
      resolve((await response.json()) as SessionBody);
    };
    page.on("response", onResponse);
  });
}

test("refresh mid-video resumes at the paused position, and the next TICK doesn't regress", async ({ page }) => {
  await page.goto("/");
  await page.locator("a.featured-card").click();
  await page.waitForURL(/\/watch\/(.+)$/);
  const watchUrl = page.url();

  await clickPlayPause(page);
  await page.waitForTimeout(6_500);
  // Pause before reloading — Chromium's Media Engagement Index can let a fresh embed of a video
  // that just played autoplay on the very next load of the same origin, regardless of any
  // --autoplay-policy flag; explicitly pausing first avoids handing the reload a still-playing
  // player (also just more realistic: a real user pauses, or the tab backgrounds, before a
  // refresh — not mid-frame).
  await clickPlayPause(page, "หยุดชั่วคราว");

  const resumeResponse = captureFirstJson(page, (url, method) => method === "POST" && url.pathname === "/api/sessions");
  await page.goto(watchUrl);
  const resumed = await resumeResponse;
  expect(resumed.positionSec, "resuming mid-video should not report position 0").toBeGreaterThan(0);

  await expect(page.getByText(/ดูต่อจาก/), "the resumed-position banner must show").toBeVisible({ timeout: 30_000 });

  const nextEventsResponse = captureFirstJson(page, (url, method) => method === "POST" && /\/api\/sessions\/[^/]+\/events$/.test(url.pathname));
  await clickPlayPause(page);
  const firstEvents = await nextEventsResponse;
  expect(firstEvents.positionSec, "the first TICK after Play must be at/after the resumed position").toBeGreaterThanOrEqual(resumed.positionSec);
});
