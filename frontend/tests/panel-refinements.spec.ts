import { test, expect, type Page } from "@playwright/test";
import {
  outboundTemplate,
  setConfigPath,
  routingPreset,
  parsePorts,
} from "../src/lib/network-config";

const node = {
  id: 1,
  name: "Local",
  is_local: true,
  enabled: true,
  status: "ok",
  config_patch: {},
};
async function panel(page: Page, path: string) {
  const outbounds: any[] = [],
    rules: any[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("veloray-theme", "dark");
    localStorage.setItem("veloray-locale", "en");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      resource = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    let json: any = {};
    if (resource === "auth/me")
      json = { id: 1, username: "admin", is_superuser: true, permissions: [] };
    else if (resource === "settings")
      json = {
        site_name: "VeloRay",
        accent: "emerald",
        default_locale: "en",
        dashboard_refresh_seconds: 60,
      };
    else if (resource === "nodes") json = [node];
    else if (
      resource.startsWith("outbounds") ||
      resource.startsWith("routing_rules")
    ) {
      const entries = resource.startsWith("outbounds") ? outbounds : rules;
      if (route.request().method() === "POST") {
        json = { ...route.request().postDataJSON(), id: entries.length + 1 };
        entries.push(json);
      } else if (route.request().method() === "PATCH") {
        const item = entries.find((i) => i.id === +resource.split("/")[1]);
        Object.assign(item, route.request().postDataJSON());
        json = item;
      } else if (route.request().method() === "DELETE") {
        entries.splice(
          entries.findIndex((i) => i.id === +resource.split("/")[1]),
          1,
        );
        json = {};
      } else json = entries;
    } else if (resource === "overview")
      json = {
        nodes_total: 1,
        nodes_online: 1,
        clients_total: 1,
        clients_active: 1,
        clients_expiring_7d: 0,
        inbounds_total: 1,
        protocols: [],
        traffic_used_bytes: 9 * 1024 ** 3,
        traffic_raw_bytes: 3 * 1024 ** 3,
        traffic_upload_bytes: 1024 ** 3,
        traffic_download_bytes: 2 * 1024 ** 3,
      };
    else if (resource === "clients") json = [];
    else if (resource === "traffic-history")
      json = [0, 1, 2].map((i) => ({
        at: new Date(Date.now() - (2 - i) * 300000).toISOString(),
        raw_upload_traffic_bytes: i * 1024 ** 3,
        raw_download_traffic_bytes: i * 2 * 1024 ** 3,
        upload_bytes: 1024 ** 3,
        download_bytes: 2 * 1024 ** 3,
        interval_seconds: 300,
      }));
    await route.fulfill({ json });
  });
  await page.goto(path);
  await expect(page.locator("#main-content")).toBeVisible();
}
async function choose(page: Page, label: string, value: string, dialog = true) {
  const root = dialog
    ? page.getByRole("dialog")
    : page.locator("#main-content");
  await root.getByRole("combobox", { name: label, exact: true }).click();
  await page.locator(`.select-menu [data-value="${value}"]`).click();
}

test("original dark and light palette, raw upload and download", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await panel(page, "/dashboard");
  const traffic = page.locator(".traffic-directions");
  await expect(traffic.getByText("1.00 GB", { exact: true })).toBeVisible();
  await expect(traffic.getByText("2.00 GB", { exact: true })).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("9.00 GB", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('[aria-label="Traffic chart"] canvas'),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#000000");
  await page.getByRole("button", { name: "Theme: dark" }).click();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#f3f6f8");
  await page
    .getByRole("button", { name: "Transfer rate", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/refined-dashboard-light.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("outbound defaults, guided creation, duplicate, status and delete", async ({
  page,
}) => {
  await panel(page, "/outbounds");
  await expect(page.locator(".network-system-card")).toHaveCount(2);
  await expect(
    page.locator(".network-system-card").getByText("direct", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New outbound", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Edge");
  await form.getByLabel("Tag", { exact: true }).fill("edge");
  await choose(page, "Protocol", "vless");
  await form
    .getByLabel("Server address", { exact: true })
    .fill("edge.example.com");
  await form
    .getByLabel("UUID", { exact: true })
    .fill("11111111-1111-4111-8111-111111111111");
  await form.getByLabel("SNI", { exact: true }).fill("edge.example.com");
  const request = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().includes("/api/outbounds/"),
  );
  await form
    .getByRole("button", { name: "Save & deploy", exact: true })
    .click();
  const data = (await request).postDataJSON();
  expect(data.config.settings.vnext[0].address).toBe("edge.example.com");
  expect(data.config.streamSettings.tlsSettings.serverName).toBe(
    "edge.example.com",
  );
  await expect(
    page.locator("tbody").getByText("Edge", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Disable Edge", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable Edge", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Tag", { exact: true }),
  ).toHaveValue("edge-copy");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});
test("routing defaults, presets and sing-box block action", async ({
  page,
}) => {
  await panel(page, "/routing");
  await expect(
    page
      .locator(".network-system-card")
      .getByText("Panel API", { exact: true }),
  ).toBeVisible();
  await choose(page, "Core", "singbox", false);
  await expect(page.locator(".network-system-card")).toHaveCount(1);
  await page.getByRole("button", { name: "New rule", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Private IPs");
  await form
    .getByRole("button", { name: "Block private IPs", exact: true })
    .click();
  await form.getByLabel("Ports", { exact: true }).fill("443,8000-9000");
  const request = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().includes("/api/routing_rules/"),
  );
  await form
    .getByRole("button", { name: "Save & deploy", exact: true })
    .click();
  const data = (await request).postDataJSON();
  expect(data.config).toMatchObject({
    action: "reject",
    ip_is_private: true,
    port: [443],
    port_range: ["8000:9000"],
  });
  expect(data.config.outbound).toBeUndefined();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/refined-routing-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
test("editing credentials preserves advanced fields and templates remain isolated", () => {
  const config = outboundTemplate("xray", "vless");
  config.streamSettings.sockopt = { tcpFastOpen: true };
  const changed = setConfigPath(
    config,
    ["settings", "vnext", 0, "address"],
    "edge.example.com",
  );
  expect(changed.streamSettings.sockopt).toEqual({ tcpFastOpen: true });
  expect(config.settings.vnext[0].address).toBe("");
  expect(
    outboundTemplate("xray", "vless").streamSettings.sockopt,
  ).toBeUndefined();
  expect(routingPreset("singbox", "private")).toEqual({
    action: "reject",
    ip_is_private: true,
  });
  expect(() => parsePorts("9000-8000")).toThrow();
  expect(() => parsePorts("65536")).toThrow();
});
