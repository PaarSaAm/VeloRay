import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Search } from "lucide-react";
import { api, type ClientItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { FaIcon } from "@/components/ui/fa-icon";

const fmt = (b: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1),
  );
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : 2)} ${u[i]}`;
};

export function SubscriptionsPage() {
  const [items, setItems] = useState<ClientItem[]>([]),
    [query, setQuery] = useState(""),
    [copied, setCopied] = useState<number | null>(null),
    [msg, setMsg] = useState("");
  useEffect(() => {
    api<ClientItem[]>("/clients/")
      .then(setItems)
      .catch((e) => setMsg(e.message));
  }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((x) =>
          `${x.name} ${x.inbound_name} ${x.node_name}`
            .toLowerCase()
            .includes(q),
        )
      : items;
  }, [items, query]);
  async function copy(c: ClientItem, value = c.subscription_portal_url) {
    await navigator.clipboard.writeText(value);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 1200);
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="Public client portals, auto-detected feeds, Clash/Mihomo output and direct connection links."
      />
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[11px] text-red-500"
        >
          <FaIcon icon="triangle-exclamation" className="mt-0.5" />
          {msg}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border border-blue-500/15 bg-blue-500/7 text-blue-500">
                <FaIcon icon="rss" />
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Subscription profiles
                </div>
                <div className="mt-1 text-[20px] font-bold tracking-tight">
                  {items.length}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-500/15 bg-emerald-500/7 text-emerald-500">
                <FaIcon icon="circle-check" />
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Active
                </div>
                <div className="mt-1 text-[20px] font-bold tracking-tight">
                  {items.filter((x) => x.enabled).length}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-strong)]">
                <FaIcon icon="database" />
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Recorded usage
                </div>
                <div className="mt-1 text-[20px] font-bold tracking-tight">
                  {fmt(items.reduce((a, c) => a + c.used_traffic_bytes, 0))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Subscription directory</CardTitle>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              The clean URL opens the VeloRay portal in browsers and
              automatically serves a compatible feed to known VPN clients.
            </p>
          </div>
          <div className="relative w-full max-w-72">
            <Search className="pointer-events-none absolute left-3 top-3 h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              className="input pl-8 text-[11px]"
              placeholder="Search profiles"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-2">
            {filtered.map((c) => {
              const pct = c.traffic_limit_bytes
                ? Math.min(
                    100,
                    (c.used_traffic_bytes / c.traffic_limit_bytes) * 100,
                  )
                : 0;
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 transition hover:border-[var(--border-strong)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-bold">
                          {c.name}
                        </span>
                        <Badge tone={c.enabled ? "green" : "amber"}>
                          {c.enabled
                            ? "Active"
                            : c.disabled_reason || "Disabled"}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-[10px] text-[var(--muted)]">
                        {c.node_name} · {c.inbound_name}
                      </div>
                    </div>
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <FaIcon icon="link" className="text-[var(--info)]" />
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--card)] px-3 py-2.5">
                    <div className="mb-1 text-[8px] font-bold uppercase tracking-[.1em] text-[var(--muted)]">
                      Clean subscription URL
                    </div>
                    <div className="mono truncate text-[9.5px] text-[var(--muted-strong)]">
                      {c.subscription_portal_url}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[9px] text-[var(--muted)]">
                      <span>{fmt(c.used_traffic_bytes)} used</span>
                      <span>
                        {c.traffic_limit_bytes
                          ? `${fmt(c.traffic_limit_bytes)} total`
                          : "Unlimited"}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--card)]">
                      <div
                        className="h-full rounded-full bg-[var(--brand)]"
                        style={{
                          width: `${c.traffic_limit_bytes ? Math.max(1, pct) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => copy(c)}>
                      {copied === c.id ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied === c.id ? "Copied" : "Copy link"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        window.open(
                          c.subscription_portal_url,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open portal
                    </Button>
                    {c.protocol === "wireguard" ? (
                      <>
                        <a
                          className="inline-flex h-8 items-center gap-2 rounded-lg border border-transparent px-2.5 text-[10px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--card)]"
                          href={`${c.subscription_portal_url}?format=wireguard`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FaIcon icon="file-shield" />
                          WG config
                        </a>
                        {c.profile_text && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copy(c, c.profile_text)}
                          >
                            <FaIcon icon="copy" />
                            Copy config
                          </Button>
                        )}
                      </>
                    ) : !["http", "socks"].includes(c.protocol) ? (
                      <>
                        <a
                          className="inline-flex h-8 items-center gap-2 rounded-lg border border-transparent px-2.5 text-[10px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--card)]"
                          href={`${c.subscription_portal_url}?format=clash`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FaIcon icon="layer-group" />
                          Clash
                        </a>
                        <a
                          className="inline-flex h-8 items-center gap-2 rounded-lg border border-transparent px-2.5 text-[10px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--card)]"
                          href={`${c.subscription_portal_url}?format=raw`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FaIcon icon="terminal" />
                          Raw
                        </a>
                      </>
                    ) : (
                      <span className="inline-flex h-8 items-center rounded-lg px-2.5 text-[9px] text-[var(--muted)]">
                        Credentials in portal
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!filtered.length && (
            <div className="grid place-items-center px-5 py-12 text-center">
              <FaIcon
                icon="rss"
                className="mb-3 text-[20px] text-[var(--muted)]"
              />
              <div className="text-[12px] font-semibold">
                No subscriptions found
              </div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                Create a client to generate a subscription endpoint.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
