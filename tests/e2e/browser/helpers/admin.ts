import { type Page } from "@playwright/test";

export async function adminLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(email);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 15_000 });
}
