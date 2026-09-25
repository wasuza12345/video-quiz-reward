// The app never puts its YT.Player instance on `window` — useYouTubePlayer.ts (public) and
// useAdminYouTubePreview.ts (admin) both keep it in React state only. Cheating "from the browser
// console" (plan §10 flow: `player.seekTo(40)`) and driving the admin preview player's position
// both need a real handle on the instance, so this wraps `window.YT.Player` (before any page
// script runs) to stash whichever instance gets constructed onto `window.__ytPlayer`. Test-only
// instrumentation — the app itself is never touched.
import type { Page } from "@playwright/test";

export async function exposeYouTubePlayerOnWindow(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The IFrame API does `window.YT = window.YT || {}` and THEN `window.YT.Player = ...` as a
    // separate mutation of that object — a getter/setter on `window.YT` itself never sees the
    // second step, and by the time a setInterval poll's callback runs (a macrotask), the app's
    // loadYouTubeIframeApi() has already resolved its promise and called `new YT.Player(...)`
    // with the still-unwrapped constructor (its `onYouTubeIframeAPIReady` handler runs
    // synchronously, then resolves a promise whose `.then()` — a microtask — still beats the
    // next setInterval tick). So: hook `window.onYouTubeIframeAPIReady` itself, which the app
    // chains onto (`previous?.()` runs first in its own handler) — that runs synchronously
    // before the app ever reads `YT.Player`, guaranteeing the wrap lands in time.
    type PlayerCtor = { new (...args: unknown[]): unknown; __wrapped?: boolean };
    const wrap = () => {
      const ns = (window as unknown as { YT?: { Player?: PlayerCtor } }).YT;
      if (!ns?.Player || ns.Player.__wrapped) return;
      const OriginalPlayer = ns.Player;
      function WrappedPlayer(this: unknown, ...args: unknown[]) {
        const instance = new OriginalPlayer(...args);
        (window as unknown as { __ytPlayer: unknown }).__ytPlayer = instance;
        return instance;
      }
      WrappedPlayer.__wrapped = true;
      ns.Player = WrappedPlayer as unknown as PlayerCtor;
    };
    (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = wrap;
    // Fallback poll, for a second player construction on a page where window.YT is already
    // loaded (onYouTubeIframeAPIReady won't fire again) but Player somehow isn't wrapped yet.
    const interval = window.setInterval(wrap, 10);
    window.setTimeout(() => window.clearInterval(interval), 30_000);
  });
}

export async function waitForWindowPlayer(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __ytPlayer?: unknown }).__ytPlayer), undefined, { timeout });
}

/**
 * Clears `window.__ytPlayer` before a client-side (same-document) navigation that will construct
 * a NEW player instance — e.g. the admin create→edit page transition (`router.push`, not a full
 * reload). Without this, `waitForWindowPlayer` resolves instantly against the OLD, by-then-
 * destroyed instance (its wrapped object still exists; calling a method on it throws, since the
 * underlying iframe is gone), rather than waiting for the new one.
 */
export function resetWindowPlayer(page: Page): Promise<void> {
  return page.evaluate(() => {
    delete (window as unknown as { __ytPlayer?: unknown }).__ytPlayer;
  });
}

export function getPlayerCurrentTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __ytPlayer: { getCurrentTime(): number } }).__ytPlayer.getCurrentTime());
}

export function getPlayerState(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __ytPlayer: { getPlayerState(): number } }).__ytPlayer.getPlayerState());
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
