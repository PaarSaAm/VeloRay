import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";

type AuditItem = {
  id: number;
  actor_name: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
};

function tone(action: string) {
  if (action.includes("delete") || action.includes("disable"))
    return "red" as const;
  if (action.includes("deploy") || action.includes("create"))
    return "green" as const;
  if (
    action.includes("update") ||
    action.includes("toggle") ||
    action.includes("reset")
  )
    return "blue" as const;
  return "neutral" as const;
}

export function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]),
    [query, setQuery] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setItems(await api<AuditItem[]>("/audit/"));
      setMsg("");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((x) =>
          `${x.actor_name} ${x.action} ${x.target} ${x.ip_address || ""}`
            .toLowerCase()
            .includes(q),
        )
      : items;
  }, [items, query]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Account, client and server changes."
        actions={
          <Button variant="outline" onClick={load} disabled={busy}>
            <RefreshCw
              className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
            />
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
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent events</CardTitle>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Up to 500 latest audit records
            </p>
          </div>
          <div className="relative w-full max-w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              className="input h-8 pl-8 text-[11px]"
              placeholder="Search audit"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block table-wrap">
            <table className="data-table min-w-[850px]">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>IP</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">
                      {new Date(x.created_at).toLocaleString()}
                    </td>
                    <td>{x.actor_name}</td>
                    <td>
                      <Badge tone={tone(x.action)}>{x.action}</Badge>
                    </td>
                    <td>{x.target || "—"}</td>
                    <td className="mono text-[10px]">{x.ip_address || "—"}</td>
                    <td>
                      <span className="mono truncate-cell max-w-72 text-[9px] text-[var(--muted)]">
                        {Object.keys(x.detail || {}).length
                          ? JSON.stringify(x.detail)
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-[var(--border-subtle)] md:hidden">
            {filtered.map((x) => (
              <div key={x.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold">
                      {x.target || x.action}
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">
                      {x.actor_name} · {new Date(x.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Badge tone={tone(x.action)}>{x.action}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--muted)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {x.ip_address || "No source IP"}
                </div>
              </div>
            ))}
          </div>
          {!filtered.length && (
            <div className="p-10 text-center text-[11px] text-[var(--muted)]">
              No audit events found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
