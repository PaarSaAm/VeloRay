import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
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
    "Import data",
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
    await expect(
      page.getByRole("heading", {
        name: name === "API" ? "API reference" : name,
        exact: true,
      }),
    ).toBeVisible();
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
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
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
  await expect(page.locator("main")).toHaveAttribute("lang", "fa");
  await page.evaluate(() =>
    document.fonts.load('500 14px "Vazirmatn"', "ورود"),
  );
  expect(
    await page
      .locator("main")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toMatch(/^Vazirmatn/);
  await expect(
    page.getByRole("button", { name: "ورود", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/login-fa.png", fullPage: true });
});

test("bundled fonts, black surfaces and visible compact navigation icons", async ({
  page,
}) => {
  // The panel must render when third-party font/CDN requests are unavailable.
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1" || host === "localhost") await route.continue();
    else await route.abort();
  });
  await page.goto("/");
  const fonts = await page.evaluate(async () => {
    const inter = await document.fonts.load('500 14px "Inter"', "Traffic 123");
    const vazirmatn = await document.fonts.load(
      '500 14px "Vazirmatn"',
      "مصرف ۱۲۳",
    );
    return [...inter, ...vazirmatn].map((font) => ({
      family: font.family,
      status: font.status,
    }));
  });
  expect(fonts).toEqual([
    { family: "Inter", status: "loaded" },
    { family: "Vazirmatn", status: "loaded" },
  ]);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.locator("aside").first()).toHaveCSS(
    "background-color",
    "rgb(5, 5, 5)",
  );
  const dashboard = page
    .getByRole("button", { name: "Dashboard", exact: true })
    .first();
  await expect(dashboard.locator("svg")).toHaveCSS("width", "18px");
  await expect(dashboard.locator("svg")).toHaveAttribute("stroke-width", "2");
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator("svg")).toBeVisible();
  const icons = await page
    .locator("aside nav .vr-icon svg")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          width: box.width,
          height: box.height,
          color: style.color,
          opacity: style.opacity,
        };
      }),
    );
  expect(icons.length).toBeGreaterThanOrEqual(13);
  for (const icon of icons) {
    expect(icon.width).toBe(18);
    expect(icon.height).toBe(18);
    expect(icon.color).not.toBe("rgb(0, 0, 0)");
    expect(icon.opacity).toBe("1");
  }
  await page.screenshot({
    path: "test-results/navigation-compact.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Theme: dark" }).click();
  await expect(page.locator("html")).toHaveClass("light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#f3f6f8",
  );
  await page.screenshot({
    path: "test-results/dashboard-light.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveClass("light");
  await page.getByRole("button", { name: "Theme: light" }).click();
  await page.getByRole("button", { name: "Theme: system" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileNav = page.locator("aside").last();
  await expect(mobileNav.getByText("Dashboard", { exact: true })).toBeVisible();
  await expect(
    mobileNav
      .getByRole("button", { name: "Dashboard", exact: true })
      .locator("svg"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/navigation-mobile.png",
    fullPage: true,
  });
});

test("runtime validation and private configuration download", async ({
  page,
}) => {
  await page.goto("/xray");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Xray Core", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Configuration is valid",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^veloray-node-\d+\.json$/);
  expect(await download.failure()).toBeNull();
  await page.screenshot({
    path: "test-results/runtime-desktop.png",
    fullPage: true,
  });
});

test("live port checks, batch creation and usage export", async ({ page }) => {
  test.skip(
    !process.env.VELORAY_E2E_OCCUPIED_PORT,
    "needs an isolated occupied-port fixture",
  );
  await page.goto("/inbounds");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inbounds", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Connection preset", { exact: true })
    .selectOption("reality");
  await page
    .getByLabel("Port", { exact: true })
    .fill(process.env.VELORAY_E2E_OCCUPIED_PORT!);
  await page.getByRole("button", { name: "Check port", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `TCP :${process.env.VELORAY_E2E_OCCUPIED_PORT}` }),
  ).toContainText(`pid=${process.env.VELORAY_E2E_OCCUPIED_PID}`);
  await page.getByLabel("Port", { exact: true }).fill("2053");
  await page.getByRole("button", { name: "Check port", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Port check passed" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clients", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Batch create", exact: true }).click();
  await page.getByLabel("Name prefix", { exact: true }).fill("browser-batch");
  await page.getByLabel("Number of clients").fill("3");
  await page.getByLabel("Traffic multiplier / ضریب مصرف").fill("-0.5");
  await expect(page.locator("#multiplier-help")).toContainText(
    "0.500 GB billed",
  );
  await page
    .getByRole("button", { name: "Create clients", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row", { name: /^Select browser-batch-001 / }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /^Select browser-batch-003 / }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export usage", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  expect(download.suggestedFilename()).toBe("veloray-client-usage.csv");
  const csv = readFileSync(path!, "utf8");
  expect(csv).toContain("browser-batch-003");
  expect(csv).not.toContain("credential");
  expect(csv).not.toContain("subscription_token");
  expect(csv).toContain("traffic_multiplier");
  const clients = await (await page.request.get("/api/clients/")).json();
  expect(
    clients
      .filter((c: any) => c.name.startsWith("browser-batch"))
      .map((c: any) => c.traffic_multiplier),
  ).toEqual([-0.5, -0.5, -0.5]);
  await page.getByLabel("Select all visible clients", { exact: true }).check();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "browser-batch-001" }),
  ).toContainText("Disabled");
  await page.getByLabel("Select all visible clients", { exact: true }).check();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "browser-batch-001" }),
  ).toContainText("Active");
  await page
    .getByRole("button", { name: "Xray Core", exact: true })
    .first()
    .click();
  await expect(page.getByText("In use by Xray").first()).toBeVisible();
  const diagnostics = page.waitForEvent("download");
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  const report = await diagnostics;
  const data = readFileSync((await report.path())!, "utf8");
  for (const key of [
    "agent_token",
    "subscription_token",
    "credential",
    "reality_private_key",
  ])
    expect(data).not.toContain(key);
  await page.screenshot({
    path: "test-results/listener-checks-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/listener-checks-mobile.png",
    fullPage: true,
  });
});

test("negative multiplier creation, editing and mobile explanation", async ({
  page,
}) => {
  await page.goto("/clients");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await page
    .getByLabel("Client name", { exact: true })
    .fill("browser-discount");
  const inbound = await (await page.request.get("/api/inbounds/")).json();
  await page
    .getByLabel("Inbound", { exact: true })
    .selectOption(String(inbound.find((i: any) => i.name === "main").id));
  const multiplier = page.getByLabel("Traffic multiplier / ضریب مصرف");
  await multiplier.fill("-0.5");
  await expect(page.locator("#multiplier-help")).toContainText(
    "1 GB actual → 0.500 GB billed",
  );
  await page.screenshot({
    path: "test-results/multiplier-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await multiplier.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/multiplier-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create client", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const row = page.getByRole("row").filter({ hasText: "browser-discount" });
  await row
    .getByRole("button", { name: "Actions for browser-discount", exact: true })
    .click();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(multiplier).toHaveValue("-0.5");
  await multiplier.fill("4");
  expect(
    await multiplier.evaluate(
      (input: HTMLInputElement) => input.validity.rangeOverflow,
    ),
  ).toBe(true);
  await multiplier.fill("3");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const clients = await (await page.request.get("/api/clients/")).json();
  expect(
    clients.find((c: any) => c.name === "browser-discount").traffic_multiplier,
  ).toBe(3);
});

test("backup preview and disabled import preserve a shared account", async ({
  page,
}) => {
  test.skip(
    !process.env.VELORAY_E2E_IMPORT_DB,
    "needs a privately supplied backup fixture",
  );
  await page.goto("/imports");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Import data", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Backup file", { exact: true })
    .setInputFiles(process.env.VELORAY_E2E_IMPORT_DB!);
  const previewing = page.waitForResponse(
    (r) =>
      r.url().includes("/imports/preview") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Preview backup", exact: true })
    .click();
  const previewResponse = await previewing;
  expect(previewResponse.ok()).toBe(true);
  const preview = await previewResponse.json();
  expect(preview.accounts).toBe(1);
  expect(preview.client_links).toBe(5);
  const serialized = JSON.stringify(preview);
  expect(serialized).not.toContain('"credential"');
  expect(serialized).not.toContain('"subscription_token"');
  const commit = page.getByRole("button", {
    name: "Import selected data",
    exact: true,
  });
  await expect(commit).toBeDisabled();
  await page.screenshot({
    path: "test-results/import-preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Change import language" }).click();
  await expect(
    page.getByRole("heading", { name: "واردسازی داده‌ها" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/import-preview-mobile-fa.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Change import language" }).click();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the warnings. Save selected inbounds disabled so I can verify them before activation.",
    })
    .check();
  await commit.click();
  await expect(
    page.getByRole("heading", { name: "Data imported" }),
  ).toBeVisible();
  const inbounds = await (await page.request.get("/api/inbounds/")).json();
  const imported = inbounds.filter((i: any) => i.name !== "main");
  expect(imported).toHaveLength(5);
  expect(imported.every((i: any) => i.enabled === false)).toBe(true);
  const clients = await (await page.request.get("/api/clients/")).json();
  const members = clients.filter((c: any) => c.account_id);
  expect(members).toHaveLength(5);
  expect(new Set(members.map((c: any) => c.account_id)).size).toBe(1);
  expect(new Set(members.map((c: any) => c.subscription_url)).size).toBe(1);
  expect(members.every((c: any) => c.used_traffic_bytes === 0)).toBe(true);
});
