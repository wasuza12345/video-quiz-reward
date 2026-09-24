import { expect, type Page } from "@playwright/test";

/**
 * Clicks the public watch page's Play/Pause control. Two elements share the same aria-label: the
 * video's transparent click-shield (VideoPlayer.tsx, always natively enabled — no `disabled`
 * attribute at all) and ControlBar's own button (real `disabled={!enabled}`, true only once the
 * YT player has actually finished initializing). Waiting on the SHIELD's own `toBeEnabled()`
 * would pass instantly and then race `handleToggle`'s `if (!player) return` no-op — wait for and
 * click ControlBar's button (`.last()`, since VideoPlayer renders before it) instead.
 */
export async function clickPlayPause(page: Page, label: "เล่นวิดีโอ" | "หยุดชั่วคราว" = "เล่นวิดีโอ"): Promise<void> {
  const btn = page.getByRole("button", { name: label }).last();
  // Generous: this shared machine's load varies a lot run to run (many concurrent agents/tabs),
  // and player init after a fresh navigation is the step most sensitive to that.
  await expect(btn).toBeEnabled({ timeout: 40_000 });
  await btn.click();
}
