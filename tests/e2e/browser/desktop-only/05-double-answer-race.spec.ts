// Planner-requested regression case: clean-code/reviewer found that tapping a second choice
// during the ~900ms window between a correct answer and the dialog auto-closing double-submits
// ANSWER_SUBMITTED. The server correctly rejects the 2nd POST (409 NOT_AT_QUIZ), but the client's
// ANSWER_FAILED handler for NOT_AT_QUIZ used to show the resync toast and pause playback instead
// of silently ignoring it and letting the already-in-flight correct-answer auto-resume proceed
// (watch.machine.ts ANSWER_FAILED case, `copy.toast.gateFallback` = "ขอปรับตำแหน่งวิดีโอให้ตรงกันก่อนนะคะ").
import { expect, test, type Response } from "@playwright/test";
import { clickPlayPause } from "../helpers/watch";

test.setTimeout(180_000);

const CORRECT_CHOICE_LABEL = "D";
const OTHER_CHOICE_LABEL = "A";
const GATE_FALLBACK_TOAST = "ขอปรับตำแหน่งวิดีโอให้ตรงกันก่อนนะคะ";

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

test("answer D correctly, then immediately tap another choice: only one POST /answer, no toast, playback auto-resumes", async ({ page }) => {
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

  // Fire both clicks concurrently (not sequentially awaited) — a sequential await-then-click
  // gives the first click's full round trip (actionability wait + network) time to resolve
  // before the second one is even dispatched, which can miss the ~900ms race window entirely.
  // Racing them with Promise.all gets the 2nd click's dispatch much closer to the 1st.
  await Promise.all([
    correctChoice.click(),
    otherChoice.click({ force: true, timeout: 3_000 }).catch(() => {
      // If the fix disables the button fast enough, this click may simply never find an
      // actionable target — that's a PASS for this spec (no race window to exploit), not a failure.
    }),
  ]);

  await expect(dialog, "the quiz dialog must close and playback resume after the correct answer").toBeHidden({ timeout: 5_000 });

  // The toast that the current bug shows must never appear.
  await expect(page.getByText(GATE_FALLBACK_TOAST), "the resync/gate-fallback toast must never fire from a double-answer race").not.toBeVisible({
    timeout: 2_000,
  });

  // Playback must auto-resume (not get stuck paused) — the real pause button becomes visible and
  // enabled only once the player is actually playing again.
  await expect(page.getByRole("button", { name: "หยุดชั่วคราว" }).last(), "playback must auto-resume after the correct answer, not stay paused").toBeVisible({
    timeout: 10_000,
  });

  const rewardText = page.getByText(/\+\d+\s*Points/);
  await expect(rewardText, "the honest watch must still finish and reward normally after the race").toBeVisible({ timeout: 60_000 });

  answerLog.dispose();
  const answerCount = answerLog.responses.length;
  expect(answerCount, `expected exactly 1 POST /answer despite the double-tap, got ${answerCount}`).toBe(1);
});
