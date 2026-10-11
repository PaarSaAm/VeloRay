import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, path = "/dashboard") {
  await page.goto(path);
  if (await page.locator("#main-content").isVisible()) return;
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.VELORAY_E2E_PASSWORD || "Test-password-very-long");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.locator("#main-content")).toBeVisible();
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.locator(`.select-menu [data-value="${value}"]`).click();
}
async function mutate(page: Page, path: string, body: any) {
  const csrf =
    (await page.context().cookies()).find((c) => c.name === "csrftoken")
      ?.value || "";
  const res = await page.request.post(`/api${path}`, {
    data: body,
    headers: {
      "X-CSRFToken": decodeURIComponent(csrf),
      Origin: new URL(page.url()).origin,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}
async function ensureInbound(page: Page) {
  const rows = await (await page.request.get("/api/inbounds/")).json();
  return (
    rows.find((i: any) => i.name === "main") ||
    mutate(page, "/inbounds/", {
      name: "main",
      node: (await (await page.request.get("/api/nodes/")).json())[0].id,
      core: "xray",
      protocol: "vless",
      transport: "raw",
      security: "none",
      port: 24081,
      listen: "0.0.0.0",
    })
  );
}
test("navigation, two themes, smooth chart and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/traffic-history?**", (r) =>
    r.fulfill({
      json: [0, 1, 2, 3, 4].map((n) => ({
        at: new Date(Date.now() - (4 - n) * 900000).toISOString(),
        used_traffic_bytes: n * 1024 ** 3,
        bytes: 1024 ** 3,
      })),
    }),
  );
  await login(page);
  await expect(
    page.locator("nav").getByRole("button", { name: "Traffic", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('[role="img"][aria-label="Traffic chart"] canvas'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Transfer rate", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/v1-dashboard.png",
    fullPage: true,
  });
  for (const name of [
    "Inbounds",
    "Outbounds",
    "Routing",
    "Clients",
    "Nodes",
    "Xray Core",
    "API",
    "Settings",
    "Accounts",
  ]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .first()
      .click();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Theme: dark" }).click();
  await expect(page.locator("html")).toHaveClass("light");
  await page.getByRole("button", { name: "Theme: light" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.getByRole("button", { name: "Theme: system" })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/v1-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("separate inbound editor, keyboard selector and SNI scanner", async ({
  page,
}) => {
  await login(page, "/inbounds");
  await page.getByRole("button", { name: "New inbound", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New inbound" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await choose(page, "Core", "singbox");
  const protocol = page.getByRole("combobox", {
    name: "Protocol",
    exact: true,
  });
  await protocol.focus();
  await protocol.press("ArrowDown");
  await protocol.press("Enter");
  await expect(protocol).toHaveText(/VMess/);
  await choose(page, "Protocol", "vless");
  await page.getByRole("button", { name: "REALITY", exact: true }).click();
  await page.getByRole("button", { name: "Scan SNI", exact: true }).click();
  await page.getByRole("button", { name: "Find SNI", exact: true }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "SNI scanner" })).toHaveCount(
    0,
  );
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: "test-results/v1-inbound.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("first-use, devices, charged usage and automatic suffix", async ({
  page,
}) => {
  const name = `v1-first-use-${Date.now()}`;
  await login(page, "/clients");
  const i = await ensureInbound(page);
  await page.reload();
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await page.getByLabel("Client name", { exact: true }).fill(name);
  await choose(page, "Inbound", String(i.id));
  await page.getByLabel("Start after first use", { exact: true }).check();
  await page.getByLabel("Expiry after (days)", { exact: true }).fill("7");
  await page.getByLabel("Devices", { exact: true }).fill("2");
  await page.getByLabel("Traffic multiplier", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Create client", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const rows = await (await page.request.get("/api/clients/")).json(),
    c = rows.find((c: any) => c.name === name);
  expect(c).toMatchObject({
    device_limit: 2,
    start_after_first_use: true,
    duration_days: 7,
    expires_at: null,
    first_used_at: null,
    traffic_multiplier: 3,
  });
  expect(decodeURIComponent(c.share_link)).toMatch(/3\.0x$/);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("Used");
  await expect(row).not.toContainText(/billed|actual|Shared across/);
  await expect(row.locator(".client-avatar svg")).toBeVisible();
  await page.screenshot({
    path: "test-results/v1-clients.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#main-content")).not.toContainText(
    /billed|Actual:/,
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
test("one-time API key and reset revocation", async ({ page }) => {
  const name = `v1-key-${Date.now()}`;
  await login(page, "/api-docs");
  await page
    .getByRole("button", { name: "Create key", exact: true })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: "Create key" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByRole("button", { name: "Create key", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Your API key" });
  await expect(dialog).toBeVisible();
  const old = await dialog.locator('[dir="ltr"]').innerText();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#main-content")).not.toContainText(old);
  const listed = await (await page.request.get("/api/admin/api-keys/")).json();
  expect(listed.find((k: any) => k.name === name).token).toBeUndefined();
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  const fresh = await dialog.locator('[dir="ltr"]').innerText();
  expect(fresh).not.toBe(old);
  expect(
    (
      await page.request.get("/api/clients/", {
        headers: { Authorization: `Bearer ${old}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.get("/api/clients/", {
        headers: { Authorization: `Bearer ${fresh}` },
      })
    ).ok(),
  ).toBeTruthy();
});
test("import file alignment and functional checkboxes", async ({ page }) => {
  await login(page, "/settings");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await expect(page.locator("form form")).toHaveCount(0);
  const fixture = {
    tables: {
      inbounds: [
        {
          id: 991,
          remark: "v1-import",
          port: 24581,
          protocol: "vless",
          listen: "0.0.0.0",
          enable: true,
          settings: JSON.stringify({
            clients: [
              {
                id: "955cc471-391e-4f25-bc37-c8336ed2be5b",
                email: "v1-import-client",
                enable: true,
                totalGB: 0,
                expiryTime: 0,
              },
            ],
          }),
          stream_settings: JSON.stringify({ network: "tcp", security: "none" }),
        },
      ],
    },
  };
  const box = page.locator(".backup-file-field"),
    before = await box.boundingBox();
  await page.getByLabel("Backup file", { exact: true }).setInputFiles({
    name: "a-long-import-backup-file-name.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const after = await box.boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(after!.y).toBe(before!.y);
  await page
    .getByRole("button", { name: "Preview backup", exact: true })
    .click();
  const choice = page.getByRole("checkbox").first();
  await expect(choice).toBeEnabled();
  await choice.uncheck();
  await expect(choice).not.toBeChecked();
  await choice.check();
  await page.getByRole("checkbox", { name: /I reviewed the warnings/ }).check();
  await expect(
    page.getByRole("button", { name: "Import selected data", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/v1-import.png", fullPage: true });
});
test("outbound and routing native configuration persistence", async ({
  page,
}) => {
  const tag = `v1-egress-${Date.now()}`,
    rule = `v1-rule-${Date.now()}`;
  await login(page, "/outbounds");
  await page.getByRole("button", { name: "New outbound", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).fill(tag);
  await d.getByLabel("Tag", { exact: true }).fill(tag);
  await d.getByRole("button", { name: "Save & deploy", exact: true }).click();
  await expect(d).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("button", { name: "Routing", exact: true })
    .click();
  await page.getByRole("button", { name: "New rule", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).fill(rule);
  await d.getByLabel("Configuration", { exact: true }).fill(
    JSON.stringify({
      domain: ["domain:example.com"],
      outboundTag: tag,
    }),
  );
  await d.getByRole("button", { name: "Save & deploy", exact: true }).click();
  await expect(d).toHaveCount(0);
  const rules = await (await page.request.get("/api/routing_rules/")).json();
  expect(rules.find((r: any) => r.name === rule).config.outboundTag).toBe(tag);
});

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({
    storageState: { cookies: [], origins: [] },
  });
  await login(page);
  await page.context().storageState({ path: "test-results/v1-session.json" });
  await page.close();
});
test.use({ storageState: "test-results/v1-session.json" });
