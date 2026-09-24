// P6-early — proxy.ts item 8: `Secure` on http://localhost. Needs a real browser cookie jar
// (unlike the `request`-fixture tests in proxy.spec.ts), because it's the BROWSER, not the
// server, that decides whether to keep a Secure-flagged cookie set over plain http. Runs on both
// the "chromium" and "webkit" projects (see playwright.config.ts testMatch).
import { expect, test } from "@playwright/test";

test("Secure cookie over http://localhost: Chromium keeps it, WebKit does not (skip there)", async ({ page, context, browserName }) => {
  await page.goto("/");
  const cookies = await context.cookies();
  const vqUid = cookies.find((c) => c.name === "vq_uid");

  if (browserName === "webkit") {
    // WebKit does not special-case localhost as a secure context: a `Secure` cookie set over
    // plain http is dropped by the browser. This is expected, not a bug (plan §10 item 8) —
    // WebKit-based deployments need real https (as prod does, via Vercel).
    test.skip(!vqUid, "WebKit correctly refuses to store a Secure cookie over http://localhost");
  }

  expect(vqUid, "Chromium treats http://localhost as a secure context and keeps the Secure cookie").toBeTruthy();
  expect(vqUid!.httpOnly).toBe(true);
  expect(vqUid!.secure).toBe(true);
  expect(vqUid!.sameSite).toBe("Lax");

  // Reload: the same id must be kept (no re-issue) since the browser already holds it.
  await page.goto("/");
  const afterReload = (await context.cookies()).find((c) => c.name === "vq_uid");
  expect(afterReload?.value).toBe(vqUid!.value);
});
