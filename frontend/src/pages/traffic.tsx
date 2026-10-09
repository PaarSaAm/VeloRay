import { useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { api, type ClientItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
const fmt = (b: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1),
  );
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : 2)} ${u[i]}`;
};
export function TrafficPage() {
  const [items, setItems] = useState<ClientItem[]>([]),
    [msg, setMsg] = useState("");
  const load = () => api<ClientItem[]>("/clients/").then(setItems);
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
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
        title="Traffic"
        description="Track usage, quotas and renewal dates."
        actions={
          <Button variant="outline" onClick={() => load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
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
              Recorded traffic
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {fmt(total)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Tracked clients
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              {items.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Quota limited
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
            <CardTitle>Per-client usage</CardTitle>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Usage and quotas update every 15 seconds.
            </p>
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
                      <span>{fmt(c.used_traffic_bytes)}</span>
                      <span>
                        {c.traffic_limit_bytes
                          ? fmt(c.traffic_limit_bytes)
                          : "Unlimited"}
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
                      {c.enabled ? "Active" : c.disabled_reason || "Disabled"}
                    </Badge>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">
                      {c.last_traffic_at
                        ? new Date(c.last_traffic_at).toLocaleString()
                        : "No traffic yet"}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => reset(c)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </div>
              );
            })}
            {!items.length && (
              <div className="p-10 text-center text-[11px] text-[var(--muted)]">
                No client traffic yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
