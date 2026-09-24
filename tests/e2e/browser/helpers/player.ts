// The app never puts its YT.Player instance on `window` — useYouTubePlayer.ts (public) and
// useAdminYouTubePreview.ts (admin) both keep it in React state only. Cheating "from the browser
// console" (plan §10 flow: `player.seekTo(40)`) and driving the admin preview player's position
// both need a real handle on the instance, so this wraps `window.YT.Player` (before any page
// script runs) to stash whichever instance gets constructed onto `window.__ytPlayer`. Test-only
// instrumentation — the app itself is never touched.
import type { Page } from "@playwright/test";

export async function exposeYouTubePlayerOnWindow(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let realYT: unknown;
    Object.defineProperty(window, "YT", {
      configurable: true,
      get() {
        return realYT;
      },
      set(value) {
        realYT = value;
        const ns = value as { Player?: { new (...args: unknown[]): unknown; __wrapped?: boolean } } | undefined;
        if (ns?.Player && !ns.Player.__wrapped) {
          const OriginalPlayer = ns.Player;
          function WrappedPlayer(this: unknown, ...args: unknown[]) {
            const instance = new OriginalPlayer(...args);
            (window as unknown as { __ytPlayer: unknown }).__ytPlayer = instance;
            return instance;
          }
          WrappedPlayer.__wrapped = true;
          ns.Player = WrappedPlayer as unknown as typeof OriginalPlayer;
        }
      },
    });
  });
}

export async function waitForWindowPlayer(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __ytPlayer?: unknown }).__ytPlayer), undefined, { timeout });
}

export function getPlayerCurrentTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __ytPlayer: { getCurrentTime(): number } }).__ytPlayer.getCurrentTime());
}

/** Waits until `window.__ytPlayer.getDuration()` is real — the admin create-video form needs
 * this before Save is clickable (durationSec is polled from the preview player, plan §7). */
export async function waitForPlayerDuration(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const p = (window as unknown as { __ytPlayer?: { getDuration?(): number } }).__ytPlayer;
      const d = p?.getDuration?.() ?? 0;
      return d > 0;
    },
    undefined,
    { timeout },
  );
}

export function seekPlayerTo(page: Page, sec: number, allowSeekAhead = true): Promise<void> {
  return page.evaluate(
    ({ sec, allowSeekAhead }) => (window as unknown as { __ytPlayer: { seekTo(s: number, a: boolean): void } }).__ytPlayer.seekTo(sec, allowSeekAhead),
    { sec, allowSeekAhead },
  );
}
