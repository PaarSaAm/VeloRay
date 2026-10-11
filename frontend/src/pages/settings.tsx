import { t } from "@/lib/i18n";
import { useLocale, tx } from "@/lib/i18n";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  currentSession,
  type AppSettings,
  type SystemInfo,
  type TelegramStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { FaIcon } from "@/components/ui/fa-icon";

const fmt = (b: number) => {
  if (!b) return t("0 B");
  const u = ["B", t("KB"), t("MB"), t("GB"), t("TB")];
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1),
  );
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${u[i]}`;
};
const duration = (s: number) => {
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return d ? tx("{0}d {1}h", d, h) : h ? tx("{0}h {1}m", h, m) : tx("{0}m", m);
};
type Health = { status: string; version: string; database: string };
const defaults: AppSettings = {
  site_name: "VeloRay",
  support_url: "",
  announcement: "",
  announcement_url: "",
  default_locale: "en",
  default_client_days: 30,
  default_traffic_gb: 0,
  default_renewal_days: 0,
  traffic_history_days: 30,
  dashboard_refresh_seconds: 30,
  subscription_enabled: true,
  subscription_show_apps: true,
  subscription_show_qr: true,
  subscription_show_connection_uri: true,
  subscription_footer: "",
  subscription_template: "default",
  maintenance_mode: false,
  require_2fa_for_admins: false,
  api_keys_enabled: true,
  api_key_default_days: 90,
  audit_retention_days: 90,
  accent: "emerald",
  telegram_enabled: false,
  telegram_locale: "en",
  telegram_allow_changes: false,
  telegram_client_alerts: true,
  telegram_quota_warning_percent: 80,
  telegram_expiry_warning_days: 3,
  telegram_configured: false,
  telegram_owner_ids: [],
  telegram_alert_cpu_percent: 90,
  telegram_alert_memory_percent: 90,
  telegram_alert_disk_percent: 90,
  telegram_alert_cooldown_minutes: 30,
};

type Tab =
  | "general"
  | "subscription"
  | "defaults"
  | "security"
  | "telegram"
  | "system";
export function SettingsPage() {
  useLocale();
  const [h, setH] = useState<Health | null>(null),
    [cfg, setCfg] = useState<AppSettings>(defaults),
    [sys, setSys] = useState<SystemInfo | null>(null),
    [canEdit, setCanEdit] = useState(false),
    [tab, setTab] = useState<Tab>("general"),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false),
    [telegramToken, setTelegramToken] = useState(""),
    [clearTelegram, setClearTelegram] = useState(false);
  async function load() {
    try {
      const [a, b, c, u] = await Promise.all([
        api<Health>("/health"),
        api<AppSettings>("/settings"),
        currentSession().then((u) =>
          u.is_superuser || u.permissions?.includes("nodes.read")
            ? api<SystemInfo>("/system-info")
            : null,
        ),
        currentSession(),
      ]);
      setH(a);
      setCfg(b);
      setSys(c);
      setCanEdit(Boolean(u.is_superuser));
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const [botStatus, setBotStatus] = useState<TelegramStatus | null>(null);
  async function checkBot(action: "status" | "test" | "setup") {
    setBusy(true);
    setMsg("");
    try {
      const result = await api<TelegramStatus>(`/telegram/${action}`, {
        method: action === "status" ? t("GET") : t("POST"),
      });
      setBotStatus(result);
      setMsg(
        action === "status"
          ? t("Bot connection checked.")
          : action === "test"
            ? t("Test delivered to configured owners.")
            : t("Owner command menu registered."),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("Bot check failed"));
    } finally {
      setBusy(false);
    }
  }
  const diskPct = useMemo(() => Math.round(sys?.disk_percent ?? 0), [sys]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) {
      setMsg(t("Settings are read-only for non-superuser operators."));
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const payload: any = { ...cfg };
      delete payload.telegram_configured;
      if (telegramToken.trim())
        payload.telegram_bot_token = telegramToken.trim();
      if (clearTelegram) payload.telegram_clear_bot_token = true;
      const next = await api<AppSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setCfg(next);
      setTelegramToken("");
      setClearTelegram(false);
      setMsg(t("Settings saved."));
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof AppSettings, v: any) =>
    setCfg((c) => ({ ...c, [k]: v }));
  const nav: [Tab, string, string][] = [
    ["general", t("General"), "gear"],
    ["subscription", t("Subscription"), "rss"],
    ["defaults", t("Client defaults"), "sliders"],
    ["security", t("Security & API"), "shield-halved"],
    ["telegram", t("Telegram"), "paper-plane"],
    ["system", t("System"), "server"],
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Settings")}
        description={t(
          "Runtime policy, subscriptions, automation, security and host health.",
        )}
        actions={
          <Button variant="outline" onClick={load}>
            {t("Refresh")}
          </Button>
        }
      />
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[11px] text-[var(--muted-strong)]"
        >
          {msg}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Info
          icon="code-branch"
          label={t("VeloRay version")}
          value={h?.version || "0.2.0"}
        />
        <Info
          icon="database"
          label={t("Database")}
          value={h?.database || "Checking…"}
        />
        <Info
          icon="server"
          label={t("Host")}
          value={sys?.hostname || "Checking…"}
        />
        <Info
          icon="clock"
          label={t("Uptime")}
          value={sys ? duration(sys.uptime_seconds) : "Checking…"}
        />
      </div>
      {!canEdit && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-[11px] text-amber-600 dark:text-amber-400">
          <FaIcon icon="lock" className="mr-2" />
          {t(
            "Read-only operator view. Product settings can only be changed by a superuser.",
          )}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
        <Card>
          <CardContent className="p-2">
            {nav.map(([k, l, i]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-[11px] font-medium transition ${tab === k ? "bg-[var(--surface-2)] text-[var(--fg)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)]"}`}
              >
                <FaIcon icon={i} />
                {l}
              </button>
            ))}
          </CardContent>
        </Card>
        <form onSubmit={save}>
          <fieldset disabled={!canEdit} className="contents">
            {tab === "general" && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{t("General")}</CardTitle>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {t("Panel identity and interface defaults.")}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("Panel name")}>
                    <input
                      className="input"
                      value={cfg.site_name}
                      onChange={(e) => set("site_name", e.target.value)}
                    />
                  </Field>
                  <Field label={t("Default locale")}>
                    <select
                      className="input"
                      value={cfg.default_locale}
                      onChange={(e) => set("default_locale", e.target.value)}
                    >
                      <option value="en">{t("English")}</option>
                      <option value="fa">{t("Persian")}</option>
                    </select>
                  </Field>
                  <Field label={t("Support URL")} className="sm:col-span-2">
                    <input
                      className="input"
                      value={cfg.support_url}
                      onChange={(e) => set("support_url", e.target.value)}
                      placeholder={t("https://...")}
                    />
                  </Field>
                  <Field label={t("Announcement")} className="sm:col-span-2">
                    <textarea
                      className="input min-h-24"
                      value={cfg.announcement}
                      onChange={(e) => set("announcement", e.target.value)}
                      placeholder={t(
                        "Message sent to compatible subscription clients",
                      )}
                    />
                  </Field>
                  <Field
                    label={t("Announcement URL")}
                    className="sm:col-span-2"
                  >
                    <input
                      className="input"
                      value={cfg.announcement_url}
                      onChange={(e) => set("announcement_url", e.target.value)}
                      placeholder={t("https://...")}
                    />
                  </Field>
                  <Field label={t("Accent")}>
                    <select
                      className="input"
                      value={cfg.accent}
                      onChange={(e) => set("accent", e.target.value)}
                    >
                      {["emerald", "blue", "violet", "rose", "amber"].map(
                        (x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label={t("Dashboard refresh")}>
                    <select
                      className="input"
                      value={cfg.dashboard_refresh_seconds}
                      onChange={(e) =>
                        set("dashboard_refresh_seconds", Number(e.target.value))
                      }
                    >
                      {[10, 15, 30, 60, 120, 300].map((x) => (
                        <option key={x} value={x}>
                          {x}
                          {t("s")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Toggle
                    label={t("Maintenance mode")}
                    text={t(
                      "Pause public subscriptions while administrator access remains online.",
                    )}
                    checked={cfg.maintenance_mode}
                    onChange={(v) => set("maintenance_mode", v)}
                  />
                  <Actions busy={busy} />
                </CardContent>
              </Card>
            )}
            {tab === "subscription" && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{t("Subscription portal")}</CardTitle>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {t("Feed behavior and public portal presentation.")}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("Template")}>
                    <select
                      className="input"
                      value={cfg.subscription_template}
                      onChange={(e) =>
                        set("subscription_template", e.target.value)
                      }
                    >
                      <option value="default">{t("Full portal")}</option>
                      <option value="compact">{t("Compact portal")}</option>
                    </select>
                  </Field>
                  <Field label={t("Portal footer")}>
                    <input
                      className="input"
                      maxLength={180}
                      value={cfg.subscription_footer}
                      onChange={(e) =>
                        set("subscription_footer", e.target.value)
                      }
                      placeholder={t("Optional footer")}
                    />
                  </Field>
                  <Toggle
                    label={t("Subscriptions enabled")}
                    text={t("Turn public subscription endpoints on or off.")}
                    checked={cfg.subscription_enabled}
                    onChange={(v) => set("subscription_enabled", v)}
                  />
                  <Toggle
                    label={t("Recommended apps")}
                    text={t("Display compatible client suggestions.")}
                    checked={cfg.subscription_show_apps}
                    onChange={(v) => set("subscription_show_apps", v)}
                  />
                  <Toggle
                    label={t("QR code")}
                    text={t("Allow subscription URL QR display.")}
                    checked={cfg.subscription_show_qr}
                    onChange={(v) => set("subscription_show_qr", v)}
                  />
                  <Toggle
                    label={t("Connection URI")}
                    text={t("Expose the raw protocol URI when supported.")}
                    checked={cfg.subscription_show_connection_uri}
                    onChange={(v) => set("subscription_show_connection_uri", v)}
                  />
                  <Actions busy={busy} />
                </CardContent>
              </Card>
            )}
            {tab === "defaults" && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{t("Client defaults")}</CardTitle>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {t("Defaults used by Client creation.")}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("Default expiry (days)")}>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={cfg.default_client_days}
                      onChange={(e) =>
                        set("default_client_days", Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t("Default traffic (GB)")}>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={cfg.default_traffic_gb}
                      onChange={(e) =>
                        set("default_traffic_gb", Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t("Default renewal (days)")}>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={cfg.default_renewal_days}
                      onChange={(e) =>
                        set("default_renewal_days", Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t("Traffic history retention")}>
                    <select
                      className="input"
                      value={cfg.traffic_history_days}
                      onChange={(e) =>
                        set("traffic_history_days", Number(e.target.value))
                      }
                    >
                      {[7, 14, 30, 60, 90, 180, 365].map((x) => (
                        <option key={x} value={x}>
                          {x} {t("days")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Actions busy={busy} />
                </CardContent>
              </Card>
            )}
            {tab === "security" && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{t("Security & API")}</CardTitle>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {t("Administrator authentication and automation policy.")}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Toggle
                    label={t("Require administrator 2FA")}
                    text={t("Staff must enroll TOTP before protected API use.")}
                    checked={cfg.require_2fa_for_admins}
                    onChange={(v) => set("require_2fa_for_admins", v)}
                  />
                  <Toggle
                    label={t("Enable API keys")}
                    text={t("Allow scoped Bearer tokens from Accounts.")}
                    checked={cfg.api_keys_enabled}
                    onChange={(v) => set("api_keys_enabled", v)}
                  />
                  <Field label={t("Default API key lifetime")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="3650"
                      value={cfg.api_key_default_days}
                      onChange={(e) =>
                        set("api_key_default_days", Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t("Audit retention")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="3650"
                      value={cfg.audit_retention_days}
                      onChange={(e) =>
                        set("audit_retention_days", Number(e.target.value))
                      }
                    />
                  </Field>
                  <Actions busy={busy} />
                </CardContent>
              </Card>
            )}
            {tab === "telegram" && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{t("Telegram automation")}</CardTitle>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {t("Owner-only alerts and management commands.")}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[9px] ${cfg.telegram_configured ? "bg-emerald-500/10 text-emerald-500" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}
                  >
                    {cfg.telegram_configured
                      ? t("Token configured")
                      : t("No token")}
                  </span>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Toggle
                    label={t("Telegram enabled")}
                    text={t(
                      "Send alerts and accept commands from configured owner IDs.",
                    )}
                    checked={cfg.telegram_enabled}
                    onChange={(v) => set("telegram_enabled", v)}
                  />
                  <Toggle
                    label={t("Allow bot management")}
                    text={t(
                      "Enable confirmed client and node changes. Required panel 2FA keeps bot management read-only.",
                    )}
                    checked={cfg.telegram_allow_changes}
                    onChange={(v) => set("telegram_allow_changes", v)}
                  />
                  <Toggle
                    label={t("Quota and expiry alerts")}
                    text={t(
                      "Notify owners before quota exhaustion or account expiry.",
                    )}
                    checked={cfg.telegram_client_alerts}
                    onChange={(v) => set("telegram_client_alerts", v)}
                  />
                  <Field label={t("Bot language")}>
                    <select
                      className="input"
                      value={cfg.telegram_locale}
                      onChange={(e) => set("telegram_locale", e.target.value)}
                    >
                      <option value="en">{t("English")}</option>
                      <option value="fa">{t("Persian")}</option>
                    </select>
                  </Field>
                  <Field label={t("Quota warning %")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="100"
                      value={cfg.telegram_quota_warning_percent}
                      onChange={(e) =>
                        set(
                          "telegram_quota_warning_percent",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label={t("Expiry warning (days)")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="30"
                      value={cfg.telegram_expiry_warning_days}
                      onChange={(e) =>
                        set(
                          "telegram_expiry_warning_days",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label={t("Bot token")}>
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                      placeholder={
                        cfg.telegram_configured
                          ? t("Leave blank to keep current token")
                          : "123456:ABC..."
                      }
                    />
                  </Field>
                  <Field label={t("Owner IDs")} className="sm:col-span-2">
                    <input
                      className="input"
                      value={cfg.telegram_owner_ids.join(", ")}
                      onChange={(e) =>
                        set(
                          "telegram_owner_ids",
                          e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        )
                      }
                      placeholder="123456789, 987654321"
                    />
                  </Field>
                  <Field label={t("CPU alert %")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="100"
                      value={cfg.telegram_alert_cpu_percent}
                      onChange={(e) =>
                        set(
                          "telegram_alert_cpu_percent",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label={t("Memory alert %")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="100"
                      value={cfg.telegram_alert_memory_percent}
                      onChange={(e) =>
                        set(
                          "telegram_alert_memory_percent",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label={t("Disk alert %")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="100"
                      value={cfg.telegram_alert_disk_percent}
                      onChange={(e) =>
                        set(
                          "telegram_alert_disk_percent",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label={t("Alert cooldown (minutes)")}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="1440"
                      value={cfg.telegram_alert_cooldown_minutes}
                      onChange={(e) =>
                        set(
                          "telegram_alert_cooldown_minutes",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  {cfg.telegram_configured && (
                    <Toggle
                      label={t("Remove stored bot token")}
                      text={t(
                        "Clear the encrypted Telegram credential on save.",
                      )}
                      checked={clearTelegram}
                      onChange={setClearTelegram}
                    />
                  )}
                  <div className="sm:col-span-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[10px] leading-5 text-[var(--muted)]">
                    {t("Commands:")} <code>{t("/status")}</code>,{" "}
                    <code>{t("/nodes")}</code>,{" "}
                    <code>{t("/clients [page]")}</code>,{" "}
                    <code>{t("/search name")}</code>,{" "}
                    <code>{t("/client ID")}</code>, <code>{t("/link ID")}</code>
                    {t(
                      ". Management actions require a confirmation button that expires after five minutes. Every owner must start the bot before testing. Save changed settings before checking the connection.",
                    )}
                  </div>
                  <div className="sm:col-span-2 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={busy || !cfg.telegram_configured || !canEdit}
                      onClick={() => checkBot("status")}
                    >
                      {t("Check bot connection")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !cfg.telegram_configured || !canEdit}
                      onClick={() => checkBot("test")}
                    >
                      {t("Send test to owners")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !cfg.telegram_configured || !canEdit}
                      onClick={() => checkBot("setup")}
                    >
                      {t("Register owner commands")}
                    </Button>
                  </div>
                  {botStatus && (
                    <div className="sm:col-span-2 rounded-md border border-[var(--border)] p-3 text-[12px] leading-6">
                      @{botStatus.username} · {botStatus.owner_count}{" "}
                      {t("owners ·")}{" "}
                      {botStatus.webhook_configured
                        ? t("Existing webhook blocks polling")
                        : t("Polling available")}
                      <br />
                      {t("Last successful poll:")}{" "}
                      {botStatus.last_success || t("Not yet")}
                      {botStatus.last_error && (
                        <p className="text-amber-500">{botStatus.last_error}</p>
                      )}
                    </div>
                  )}
                  <Actions busy={busy} />
                </CardContent>
              </Card>
            )}
            {tab === "system" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>{t("Host health")}</CardTitle>
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {t("Live server diagnostics.")}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Read
                      label={t("CPU")}
                      value={
                        sys
                          ? tx(
                              "{0}% · {1} cores",
                              sys.cpu_percent.toFixed(1),
                              sys.cpu_count,
                            )
                          : "—"
                      }
                    />
                    <Read
                      label={t("Memory")}
                      value={
                        sys
                          ? `${fmt(sys.memory_used_bytes)} / ${fmt(sys.memory_total_bytes)} (${sys.memory_percent.toFixed(1)}%)`
                          : "—"
                      }
                    />
                    <Read
                      label={t("Swap")}
                      value={
                        sys
                          ? `${fmt(sys.swap_used_bytes)} / ${fmt(sys.swap_total_bytes)} (${sys.swap_percent.toFixed(1)}%)`
                          : "—"
                      }
                    />
                    <Read
                      label={t("Disk")}
                      value={
                        sys
                          ? `${fmt(sys.disk_used_bytes)} / ${fmt(sys.disk_total_bytes)} (${diskPct}%)`
                          : "—"
                      }
                    />
                    <Read
                      label={t("Operating system")}
                      value={sys?.platform || "—"}
                    />
                    <Read label={t("Go")} value={sys?.go_version || "—"} />
                    <Read
                      label={t("Load average")}
                      value={
                        sys
                          ? sys.load_average
                              .map((x) => x.toFixed(2))
                              .join(" · ")
                          : "—"
                      }
                    />
                    <Read
                      label={t("Admins")}
                      value={String(sys?.admins_total ?? 0)}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t("Server management")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        t("veloray status"),
                        t("veloray doctor"),
                        t("veloray backup"),
                        t("veloray port PORT"),
                        t("veloray logs web"),
                        t("veloray logs agent"),
                        t("veloray ssl EMAIL"),
                        t("veloray update"),
                      ].map((x) => (
                        <div
                          key={x}
                          className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 mono text-[10px] text-[var(--muted-strong)]"
                        >
                          {x}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </fieldset>
        </form>
      </div>
    </div>
  );
}
function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: any;
  className?: string;
}) {
  useLocale();
  return (
    <label className={`label ${className}`}>
      {label}
      {children}
    </label>
  );
}
function Info({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  useLocale();
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
          <FaIcon icon={icon} />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
            {label}
          </div>
          <div className="mt-1 truncate text-[12px] font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
function Toggle({
  label,
  text,
  checked,
  onChange,
}: {
  label: string;
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  useLocale();
  return (
    <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5 transition hover:border-[var(--border-strong)]">
      <div>
        <div className="text-[11px] font-semibold">{label}</div>
        <div className="mt-1 text-[9px] leading-4 text-[var(--muted)]">
          {text}
        </div>
      </div>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${checked ? "border-[var(--brand)] bg-[var(--brand)]" : "border-[var(--border-strong)] bg-[var(--surface-3)]"}`}
      >
        <input
          className="sr-only"
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </span>
    </label>
  );
}
function Read({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="text-[9px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 break-words text-[11px] font-medium">{value}</div>
    </div>
  );
}
function Actions({ busy }: { busy: boolean }) {
  useLocale();
  return (
    <div className="sm:col-span-2 flex justify-end pt-2">
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : t("Save settings")}
      </Button>
    </div>
  );
}
