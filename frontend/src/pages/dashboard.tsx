import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CircleGauge,
  RefreshCw,
  Server,
  WifiOff,
} from "lucide-react";
import {
  api,
  type AppSettings,
  type ClientItem,
  type NodeItem,
  type SystemInfo,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { FaIcon } from "@/components/ui/fa-icon";

type Overview = {
  nodes_total: number;
  nodes_online: number;
  clients_total: number;
  clients_active: number;
  clients_expiring_7d: number;
  traffic_used_bytes: number;
  traffic_limit_bytes: number;
  inbounds_total: number;
  protocols: { protocol: string; count: number }[];
};
type TrafficPoint = {
  at: string;
  used_traffic_bytes: number;
  active_clients: number;
  online_nodes: number;
};
const fmt = (b: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1),
  );
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : 2)} ${u[i]}`;
};
const pct = (a: number, b: number) =>
  b > 0 ? Math.min(100, Math.max(0, (a / b) * 100)) : 0;
const names: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria: "Hysteria2",
  wireguard: "WireGuard",
  http: "HTTP",
  socks: "SOCKS5",
};
function Metric({
  label,
  value,
  note,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  icon: string;
  tone?: "neutral" | "green" | "blue" | "amber";
}) {
  const tones = {
    neutral: "text-[var(--muted-strong)] bg-[var(--surface-2)]",
    green: "text-emerald-500 bg-emerald-500/10",
    blue: "text-sky-500 bg-sky-500/10",
    amber: "text-amber-500 bg-amber-500/10",
  };
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-[var(--muted)]">
            {label}
          </div>
          <div
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tones[tone]}`}
          >
            <FaIcon icon={icon} />
          </div>
        </div>
        <div className="metric-value mt-2 text-[24px] font-semibold tracking-tight text-[var(--fg)]">
          {value}
        </div>
        <div className="mt-1 min-h-8 text-[11px] leading-4 text-[var(--muted)]">
          {note}
        </div>
      </CardContent>
    </Card>
  );
}
function TrafficChart({ points }: { points: TrafficPoint[] }) {
  const data = points.length
    ? points
    : [
        {
          at: new Date().toISOString(),
          used_traffic_bytes: 0,
          active_clients: 0,
          online_nodes: 0,
        },
      ];
  const width = 900,
    height = 250,
    padX = 20,
    padTop = 16,
    padBottom = 28;
  const values = data.map((x) => x.used_traffic_bytes),
    max = Math.max(1, ...values),
    min = Math.min(...values),
    span = Math.max(1, max - min);
  const coords = data.map((d, i) => ({
    x: padX + (i / Math.max(1, data.length - 1)) * (width - padX * 2),
    y:
      padTop +
      (1 - (d.used_traffic_bytes - min) / span) * (height - padTop - padBottom),
    d,
  }));
  const line = coords
    .map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${coords.at(-1)?.x ?? padX} ${height - padBottom} L ${coords[0]?.x ?? padX} ${height - padBottom} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({
    label: fmt(min + span * (1 - v)),
    y: padTop + v * (height - padTop - padBottom),
  }));
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-[var(--muted)]">
        No traffic recorded yet.
      </div>
    );
  }
  const hp = hover === null ? null : coords[hover];
  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * width;
    let best = 0,
      dist = Infinity;
    coords.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  }
  return (
    <div
      className="chart-shell h-[280px] w-full"
      onMouseLeave={() => setHover(null)}
    >
      {hp && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(hp.x / width) * 100}%`,
            top: `${(hp.y / height) * 100}%`,
          }}
        >
          <div className="font-semibold">{fmt(hp.d.used_traffic_bytes)}</div>
          <div className="mt-0.5 text-[var(--muted)]">
            {new Date(hp.d.at).toLocaleString()}
          </div>
        </div>
      )}
      <svg
        role="img"
        aria-label={`Recorded traffic from ${fmt(values[0])} to ${fmt(values.at(-1) ?? 0)}`}
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="none"
        onMouseMove={move}
      >
        <defs>
          <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity=".25" />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padX}
              x2={width - padX}
              y1={t.y}
              y2={t.y}
              stroke="var(--chart-grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text x={padX + 2} y={t.y - 5} fill="var(--muted)" fontSize="9">
              {t.label}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#trafficFill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hp && (
          <>
            <line
              x1={hp.x}
              x2={hp.x}
              y1={padTop}
              y2={height - padBottom}
              stroke="var(--border-strong)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hp.x}
              cy={hp.y}
              r="4"
              fill="var(--card)"
              stroke="var(--chart-line)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      <div className="pointer-events-none absolute bottom-2 left-5 right-5 flex justify-between text-[9px] text-[var(--muted)]">
        <span>
          {data.length > 1
            ? new Date(data[0].at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "24h ago"}
        </span>
        <span>Now</span>
      </div>
    </div>
  );
}
export function Dashboard() {
  const [o, setO] = useState<Overview | null>(null),
    [nodes, setNodes] = useState<NodeItem[]>([]),
    [clients, setClients] = useState<ClientItem[]>([]),
    [history, setHistory] = useState<TrafficPoint[]>([]),
    [cfg, setCfg] = useState<AppSettings | null>(null),
    [sys, setSys] = useState<SystemInfo | null>(null),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    request.current = controller;
    const options = { signal: controller.signal };
    setBusy(true);
    try {
      const [ov, n, c, h, s, system] = await Promise.all([
        api<Overview>("/overview", options),
        api<NodeItem[]>("/nodes/", options),
        api<ClientItem[]>("/clients/", options),
        api<TrafficPoint[]>("/traffic-history?hours=24", options),
        api<AppSettings>("/settings", options),
        api<SystemInfo>("/system-info", options),
      ]);
      if (controller.signal.aborted) return;
      setO(ov);
      setNodes(n);
      setClients(c);
      setHistory(h);
      setCfg(s);
      setSys(system);
      setMsg("");
    } catch (e: any) {
      if (!controller.signal.aborted) setMsg(e.message);
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  useEffect(() => {
    if (!cfg) return;
    const id = setInterval(
      load,
      Math.max(5, cfg.dashboard_refresh_seconds) * 1000,
    );
    return () => clearInterval(id);
  }, [cfg?.dashboard_refresh_seconds, load]);
  const top = useMemo(
      () =>
        [...clients]
          .sort((a, b) => b.used_traffic_bytes - a.used_traffic_bytes)
          .slice(0, 5),
      [clients],
    ),
    max = Math.max(1, ...top.map((x) => x.used_traffic_bytes)),
    local = nodes.find((n) => n.is_local),
    disabled = Math.max(0, (o?.clients_total ?? 0) - (o?.clients_active ?? 0)),
    quota = o?.traffic_limit_bytes ?? 0,
    usagePct = pct(o?.traffic_used_bytes ?? 0, quota),
    maxProto = Math.max(1, ...(o?.protocols || []).map((x) => x.count));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Client traffic and server status."
        actions={
          <Button variant="outline" onClick={load} disabled={busy}>
            <RefreshCw
              className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />
      {cfg?.announcement && (
        <div className="rounded-lg border border-[var(--brand)] bg-[var(--surface-2)] px-4 py-3 text-[11px] text-[var(--muted-strong)]">
          <FaIcon icon="bullhorn" className="mr-2 text-[var(--brand)]" />
          {cfg.announcement}
        </div>
      )}
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2.5 text-[12px] text-red-500"
        >
          {msg}
        </div>
      )}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          label="CPU"
          value={`${(sys?.cpu_percent ?? 0).toFixed(1)}%`}
          note={`${sys?.cpu_count ?? 0} logical cores`}
          icon="microchip"
          tone={(sys?.cpu_percent ?? 0) > 85 ? "amber" : "blue"}
        />
        <Metric
          label="Memory"
          value={`${(sys?.memory_percent ?? 0).toFixed(1)}%`}
          note={`${fmt(sys?.memory_used_bytes ?? 0)} / ${fmt(sys?.memory_total_bytes ?? 0)}`}
          icon="memory"
          tone={(sys?.memory_percent ?? 0) > 85 ? "amber" : "green"}
        />
        <Metric
          label="Swap"
          value={`${(sys?.swap_percent ?? 0).toFixed(1)}%`}
          note={
            sys?.swap_total_bytes
              ? `${fmt(sys.swap_used_bytes)} / ${fmt(sys.swap_total_bytes)}`
              : "Not configured"
          }
          icon="arrows-rotate"
        />
        <Metric
          label="Disk"
          value={`${(sys?.disk_percent ?? 0).toFixed(1)}%`}
          note={`${fmt(sys?.disk_used_bytes ?? 0)} / ${fmt(sys?.disk_total_bytes ?? 0)}`}
          icon="hard-drive"
          tone={(sys?.disk_percent ?? 0) > 85 ? "amber" : "blue"}
        />
      </section>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Metric
          label="Active clients"
          value={String(o?.clients_active ?? 0)}
          note={`${o?.clients_total ?? 0} total · ${disabled} disabled`}
          icon="users"
          tone="green"
        />
        <Metric
          label="Healthy nodes"
          value={`${o?.nodes_online ?? 0}/${o?.nodes_total ?? 0}`}
          note={local ? "Local node enrolled" : "Waiting for local node"}
          icon="server"
          tone="blue"
        />
        <Metric
          label="Recorded traffic"
          value={fmt(o?.traffic_used_bytes ?? 0)}
          note={
            quota ? `${usagePct.toFixed(1)}% of quotas` : "Across all clients"
          }
          icon="chart-area"
        />
        <Metric
          label="Inbounds"
          value={String(o?.inbounds_total ?? 0)}
          note={`${o?.protocols?.length ?? 0} protocol families`}
          icon="diagram-project"
          tone="amber"
        />
        <Metric
          label="Expiring soon"
          value={String(o?.clients_expiring_7d ?? 0)}
          note="Within the next 7 days"
          icon="hourglass-half"
          tone="amber"
        />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.55fr_.65fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Traffic overview</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Traffic collected during the last 24 hours
              </p>
            </div>
            <div className="text-right">
              <div className="text-[18px] font-semibold">
                {fmt(o?.traffic_used_bytes ?? 0)}
              </div>
              <div className="text-[9px] text-[var(--muted)]">
                recorded total
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-5">
            <TrafficChart points={history} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Client health</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Current availability
              </p>
            </div>
            <CircleGauge className="h-4 w-4 text-[var(--muted)]" />
          </CardHeader>
          <CardContent>
            <div className="grid place-items-center py-2">
              <div
                className="relative grid h-36 w-36 place-items-center rounded-full"
                style={{
                  background: `conic-gradient(var(--brand) ${pct(o?.clients_active ?? 0, o?.clients_total ?? 0)}%, var(--surface-3) 0)`,
                }}
              >
                <div className="grid h-[116px] w-[116px] place-items-center rounded-full bg-[var(--card)] text-center">
                  <div>
                    <div className="text-[28px] font-semibold">
                      {o?.clients_active ?? 0}
                    </div>
                    <div className="text-[9px] uppercase tracking-[.12em] text-[var(--muted)]">
                      active
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Box label="Total" value={o?.clients_total ?? 0} />
              <Box label="Disabled" value={disabled} />
            </div>
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <div>
              <CardTitle>Protocol mix</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Configured inbound families
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {o?.protocols?.length ? (
              o.protocols.map((p) => (
                <div key={p.protocol}>
                  <div className="flex justify-between text-[10px]">
                    <span>{names[p.protocol] || p.protocol}</span>
                    <span className="text-[var(--muted)]">{p.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-3)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand)]"
                      style={{
                        width: `${Math.max(5, (p.count / maxProto) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-[11px] text-[var(--muted)]">
                No inbounds yet.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Nodes</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Panel node and remote agents
              </p>
            </div>
            <Badge
              tone={nodes.some((n) => n.status === "ok") ? "green" : "amber"}
            >
              {nodes.filter((n) => n.status === "ok").length} online
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border-subtle)]">
              {nodes.length ? (
                nodes.slice(0, 6).map((n) => (
                  <div
                    key={n.id}
                    className="flex min-w-0 items-center gap-3 px-5 py-3.5"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)]">
                      <Server className="h-4 w-4 text-[var(--muted-strong)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[12px] font-semibold">
                          {n.name}
                        </span>
                        {n.is_local && <Badge tone="blue">Local</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-[9px] text-[var(--muted)]">
                        {n.public_host} · {n.xray_version || "Version pending"}
                      </div>
                    </div>
                    <Badge
                      tone={
                        n.status === "ok"
                          ? "green"
                          : n.status === "offline"
                            ? "red"
                            : "amber"
                      }
                    >
                      {n.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="grid place-items-center px-5 py-12 text-center">
                  <WifiOff className="mb-3 h-5 w-5 text-[var(--muted)]" />
                  <div className="text-[12px] font-medium">
                    No nodes registered
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top consumers</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Clients ranked by traffic
              </p>
            </div>
            <ArrowUpRight className="h-4 w-4 text-[var(--muted)]" />
          </CardHeader>
          <CardContent className="space-y-4">
            {top.length ? (
              top.map((c, index) => (
                <div key={c.id}>
                  <div className="flex min-w-0 items-center justify-between gap-3 text-[10px]">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--surface-2)] text-[9px] text-[var(--muted)]">
                        {index + 1}
                      </span>
                      <span className="truncate font-medium">{c.name}</span>
                    </div>
                    <span className="shrink-0 text-[var(--muted)]">
                      {fmt(c.used_traffic_bytes)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand)]"
                      style={{
                        width: `${Math.max(2, (c.used_traffic_bytes / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-[11px] text-[var(--muted)]">
                Traffic appears after clients start using the node.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
function Box({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="text-[9px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[15px] font-semibold">{value}</div>
    </div>
  );
}
