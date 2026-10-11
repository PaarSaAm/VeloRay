import { can, useSession } from "@/lib/session";
import { useLocale, t } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { api, distinctAccounts, type ClientItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
const fmt = (b: number) => {
  if (!b) return t("0 B");
  const u = ["B", t("KB"), t("MB"), t("GB"), t("TB")];
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1),
  );
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : 2)} ${u[i]}`;
};
export function TrafficPage() {
  useLocale();
  const session = useSession();
  const [items, setItems] = useState<ClientItem[]>([]),
    [msg, setMsg] = useState("");
  const load = () =>
    api<ClientItem[]>("/traffic/clients").then((c) =>
      setItems(distinctAccounts(c)),
    );
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const c = await api<ClientItem[]>("/traffic/clients", {
          signal: controller.signal,
        });
        if (active) setItems(distinctAccounts(c));
      } catch (e) {
        if (active && !controller.signal.aborted) setMsg((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);
  const total = useMemo(
    () => items.reduce((a, c) => a + c.used_traffic_bytes, 0),
    [items],
  );
  async function reset(c: ClientItem) {
    try {
      await api(`/clients/${c.id}/reset-usage/`, { method: "POST" });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Traffic")}
        description={t("Track usage, quotas and renewal dates.")}
        actions={
          <Button variant="outline" onClick={() => load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("Refresh")}
          </Button>
        }
      />
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2.5 text-[12px] text-red-500"
        >
          {msg}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {t("Billed traffic")}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {fmt(total)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {t("Unique accounts")}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {items.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {t("Quota limited")}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {items.filter((x) => x.traffic_limit_bytes > 0).length}
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("Per-client usage")}</CardTitle>
          </div>
          <BarChart3 className="h-4 w-4 text-[var(--muted)]" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-[var(--border-subtle)]">
            {items.map((c) => {
              const pct = c.traffic_limit_bytes
                ? Math.min(
                    100,
                    (c.used_traffic_bytes / c.traffic_limit_bytes) * 100,
                  )
                : 0;
              return (
                <div
                  key={c.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[180px_1fr_140px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold">
                      {c.name}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-[var(--muted)]">
                      {c.node_name} · {c.inbound_name}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex justify-between gap-3 text-[10px] text-[var(--muted-strong)]">
                      <span>
                        {fmt(c.used_traffic_bytes)} {t("billed")}{" "}
                        <small className="text-[var(--muted)]">
                          ·{" "}
                          {fmt(
                            c.raw_used_traffic_bytes ?? c.used_traffic_bytes,
                          )}{" "}
                          {t("actual ·")} {c.effective_traffic_multiplier ?? 1}
                          {t("x")}
                        </small>
                      </span>
                      <span>
                        {c.traffic_limit_bytes
                          ? fmt(c.traffic_limit_bytes)
                          : t("Unlimited")}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className={`${pct >= 90 ? "bg-amber-500" : "bg-emerald-500"} h-full rounded-full`}
                        style={{
                          width: `${c.traffic_limit_bytes ? Math.max(1, pct) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <Badge tone={c.enabled ? "green" : "amber"}>
                      {c.enabled
                        ? t("Active")
                        : c.disabled_reason || t("Disabled")}
                    </Badge>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">
                      {c.last_traffic_at
                        ? new Date(c.last_traffic_at).toLocaleString()
                        : t("No traffic yet")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!can(session, "clients.write")}
                    onClick={() => reset(c)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("Reset")}
                  </Button>
                </div>
              );
            })}
            {!items.length && (
              <div className="p-10 text-center text-[11px] text-[var(--muted)]">
                {t("No client traffic yet.")}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
