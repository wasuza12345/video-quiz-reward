import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env.e2e") });

const PORT = process.env.E2E_PORT ?? "3100";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// P6-early (API-level) E2E suite — plan §10. Real HTTP through proxy.ts against a fresh local
// SQLite file DB (never Turso). Serial: several tests drive real wall-clock play time.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // 1 retry: the honest-flow/admin specs decode a real ~44s YouTube video on a shared machine —
  // a transient network/scheduling hiccup shouldn't fail the whole run (plan §10: "if headless
  // video timing is flaky ... document it").
  retries: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-report.json" }]],
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: `${BASE_URL}/api/videos`,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "file:./e2e.db",
      ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET ?? "",
      USER_COOKIE_SECRET: process.env.USER_COOKIE_SECRET ?? "",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "",
      PORT,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    { name: "api", testIgnore: ["**/*.browser.spec.ts", "browser/**"] },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testMatch: "proxy-secure-cookie.browser.spec.ts" },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: "proxy-secure-cookie.browser.spec.ts" },
    // P6b — real-browser UI specs (plan §10 full list). desktop-only/ (the honest real-iframe
    // flow + the admin CRUD/timeline flow) only makes sense once, so only "ui-desktop" picks it
    // up; both-viewports/ (refresh, quiz Esc, the seekTo cheat) is cheap enough to run twice.
    // No --autoplay-policy override: Chromium's own "sticky activation" (the real Play click
    // satisfies the user-gesture requirement for the rest of that document's life) already
    // covers the programmatic auto-resume after a correct answer. Forcing the policy off instead
    // made a freshly-reloaded (should-be-PAUSED) page autoplay on its own — which the app's state
    // machine never anticipated and which broke the refresh spec outright.
    {
      name: "ui-desktop",
      testDir: "./tests/e2e/browser",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "ui-mobile",
      testDir: "./tests/e2e/browser/both-viewports",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
