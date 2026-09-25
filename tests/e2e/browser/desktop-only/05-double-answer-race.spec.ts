// Planner-requested regression case, round 2 (coder-2 caught round 1 testing the wrong race):
// re-tapping a choice AFTER the correct answer was already accepted, during the ~900ms "ถูกต้อง"
// window before the dialog auto-closes, used to double-submit ANSWER_SUBMITTED. The server
// correctly rejects the 2nd POST (409 NOT_AT_QUIZ), but the client's ANSWER_FAILED handler for
// that code used to show the resync toast and pause playback instead of silently ignoring it
// (watch.machine.ts, `copy.toast.gateFallback` = "ขอปรับตำแหน่งวิดีโอให้ตรงกันก่อนนะคะ").
//
// Round 1's mistake: `otherChoice.click({force:true})` racing the FIRST click meant the wrong
// choice's POST could land first — the server legitimately reopens the quiz for a retry, and D
// then submits as a valid retry (2 real POSTs, correctly). This round only starts the race AFTER
// the correct-answer response has actually landed, so the only thing under test is a re-tap
// during the accepted-but-not-yet-closed window.
import { expect, test, type Response } from "@playwright/test";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(180_000);

const CORRECT_CHOICE_LABEL = "D";
const OTHER_CHOICE_LABEL = "A";
const GATE_FALLBACK_TOAST = "ขอปรับตำแหน่งวิดีโอให้ตรงกันก่อนนะคะ";
const CORRECT_FEEDBACK = "ถูกต้องค่ะ! เก่งมาก ดูต่อได้เลยนะคะ";

function collectAnswerResponses(page: import("@playwright/test").Page): { responses: Response[]; dispose: () => void } {
  const responses: Response[] = [];
  const onResponse = (response: Response) => {
    const req = response.request();
    if (req.method() !== "POST") return;
    if (!/\/api\/sessions\/[^/]+\/answer$/.test(new URL(response.url()).pathname)) return;
    responses.push(response);
  };
  page.on("response", onResponse);
  return { responses, dispose: () => page.off("response", onResponse) };
}

test("re-tap after D is already correct: still exactly 1 POST /answer, no toast, auto-resumes, +50", async ({ page }) => {
  const answerLog = collectAnswerResponses(page);

  await page.goto("/");
  const featured = page.locator("a.featured-card");
  await expect(featured, "the home page must show a featured video card").toBeVisible();
  await featured.click();

  await page.waitForURL(/\/watch\//);
  await clickPlayPause(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog, "the quiz dialog must open once the video reaches its trigger time").toBeVisible({ timeout: 60_000 });

  const correctChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${CORRECT_CHOICE_LABEL}:`) });
  const otherChoice = page.getByRole("button", { name: new RegExp(`^ตัวเลือก ${OTHER_CHOICE_LABEL}:`) });

  // Step 1: a normal click on the correct choice, and wait for the real accepted response —
  // not a race with anything yet.
  const answerResponsePromise = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/sessions\/[^/]+\/answer$/.test(new URL(r.url()).pathname),
  );
  await correctChoice.click();
  const answerResponse = await answerResponsePromise;
  const answerBody = (await answerResponse.json()) as { correct: boolean };
  expect(answerBody.correct, "the first answer must actually be accepted as correct before we race a re-tap").toBe(true);
  await expect(page.getByText(CORRECT_FEEDBACK), "the correct-answer feedback must show before the re-tap").toBeVisible();

  // Step 2: immediately (no wait) try another choice — this is the actual race under test, now
  // that we know we're inside the accepted-but-still-open window.
  await expect(otherChoice, "the other choice must be disabled once a correct answer is in flight/accepted").toBeDisabled({ timeout: 1_000 });
  // Also fire a raw native click event directly, bypassing Playwright's own actionability check
  // and React's synthetic event delegation entirely — proves the guard isn't just a UI-level
  // `disabled` attribute Playwright happens to respect, but actually inert against any click.
  await otherChoice.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

  await expect(dialog, "the quiz dialog must close and playback resume after the correct answer").toBeHidden({ timeout: 5_000 });

  // The toast that the pre-fix bug showed must never appear.
  await expect(page.getByText(GATE_FALLBACK_TOAST), "the resync/gate-fallback toast must never fire from a re-tap after acceptance").not.toBeVisible({
    timeout: 2_000,
  });

  // Playback must auto-resume (not get stuck paused) — the real pause button becomes visible and
  // enabled only once the player is actually playing again.
  await expect(page.getByRole("button", { name: "หยุดชั่วคราว" }).last(), "playback must auto-resume after the correct answer, not stay paused").toBeVisible({
    timeout: 10_000,
  });

  const rewardText = page.getByText(/\+\d+\s*Points/);
  await expect(rewardText, "the honest watch must still finish and reward normally after the re-tap").toBeVisible({ timeout: 60_000 });

  const pointsBadge = page.getByRole("status").filter({ hasText: "แต้ม" }).first();
  await expect(pointsBadge).toContainText("50");

  answerLog.dispose();
  const answerCount = answerLog.responses.length;
  expect(answerCount, `expected exactly 1 POST /answer total despite the re-tap, got ${answerCount}`).toBe(1);
});
