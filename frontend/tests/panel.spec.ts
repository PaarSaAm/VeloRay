import { test, expect } from "@playwright/test";
test("login, navigation, client dialog, mobile menu and logout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#main-content")).not.toContainText("undefined");
  await expect(
    page
      .locator(".metric-value")
      .filter({ hasText: /[0-9]+(?:\.[0-9]+)? (?:B|KB|MB|GB|TB)/ })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  for (const name of [
    "Nodes",
    "Inbounds",
    "Clients",
    "Subscriptions",
    "Traffic",
    "Xray Core",
    "Audit log",
    "Security",
    "API",
    "Settings",
    "Administration",
  ]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { name: name === "API" ? "API reference" : name, exact: true })).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "Clients", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add client" })).toBeVisible();
  await page.getByLabel("Client name", { exact: true }).fill("browser-client");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Dashboard", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Login", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("login is accessible in Persian", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Change login language" }).click();
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("button", { name: "ورود", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/login-fa.png", fullPage: true });
});
