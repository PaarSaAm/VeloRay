import { Dialog } from "@/components/common/dialog";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  api,
  type AppSettings,
  type ClientItem,
  type InboundItem,
} from "@/lib/api";
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
const toLocalInput = (value: string | null) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
const expiry = (value: string | null) => {
  if (!value) return "Never";
  const d = new Date(value),
    days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
};

type Editor = {
  id?: number;
  name: string;
  inbound: string;
  limit: string;
  days: string;
  expiry: string;
  renewal: string;
  note: string;
};
const blank = (
  inbound = "",
  days = "30",
  limit = "0",
  renewal = "0",
): Editor => ({
  name: "",
  inbound,
  limit,
  days,
  expiry: "",
  renewal,
  note: "",
});

export function ClientsPage() {
  const [inbounds, setInbounds] = useState<InboundItem[]>([]),
    [items, setItems] = useState<ClientItem[]>([]),
    [cfg, setCfg] = useState<AppSettings | null>(null),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [inboundFilter, setInboundFilter] = useState("all"),
    [msg, setMsg] = useState(""),
    [copied, setCopied] = useState<number | null>(null),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState<number | null>(null);
  const load = async () => {
    const [i, c, s] = await Promise.all([
      api<InboundItem[]>("/inbounds/"),
      api<ClientItem[]>("/clients/"),
      api<AppSettings>("/settings"),
    ]);
    const clientInbounds = i.filter((x) => x.supports_clients !== false);
    setInbounds(clientInbounds);
    setItems(c);
    setCfg(s);
    return { i: clientInbounds, c };
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);
  const filtered = useMemo(
    () =>
      items.filter((c) => {
        const q = query.trim().toLowerCase();
        const text =
          `${c.name} ${c.inbound_name} ${c.node_name} ${c.credential}`.toLowerCase();
        const okq = !q || text.includes(q);
        const oks =
          status === "all" || (status === "active" ? c.enabled : !c.enabled);
        const oki =
          inboundFilter === "all" || String(c.inbound) === inboundFilter;
        return okq && oks && oki;
      }),
    [items, query, status, inboundFilter],
  );
  const total = useMemo(
      () => items.reduce((a, c) => a + c.used_traffic_bytes, 0),
      [items],
    ),
    active = items.filter((c) => c.enabled).length,
    limited = items.filter((c) => c.traffic_limit_bytes > 0).length;
  const allVisible =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  function toggleSelect(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      if (allVisible) filtered.forEach((c) => n.delete(c.id));
      else filtered.forEach((c) => n.add(c.id));
      return n;
    });
  }
  async function refresh() {
    try {
      await load();
      setMsg("");
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function copy(c: ClientItem) {
    await navigator.clipboard.writeText(c.subscription_url);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 1200);
  }
  function openCreate() {
    setEditor(
      blank(
        inbounds[0] ? String(inbounds[0].id) : "",
        String(cfg?.default_client_days ?? 30),
        String(cfg?.default_traffic_gb ?? 0),
        String(cfg?.default_renewal_days ?? 0),
      ),
    );
  }
  function openEdit(c: ClientItem) {
    setEditor({
      id: c.id,
      name: c.name,
      inbound: String(c.inbound),
      limit: c.traffic_limit_bytes
        ? String(Number((c.traffic_limit_bytes / 1024 ** 3).toFixed(2)))
        : "0",
      days: "0",
      expiry: toLocalInput(c.expires_at),
      renewal: String(c.renewal_interval_days || 0),
      note: (c as any).note || "",
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setBusy(true);
    setMsg("");
    try {
      const selectedInbound = inbounds.find(
        (i) => String(i.id) === editor.inbound,
      );
      const usageMetered =
        !selectedInbound ||
        !["http", "socks", "tunnel", "tun"].includes(selectedInbound.protocol);
      const body: any = {
        name: editor.name,
        inbound: Number(editor.inbound),
        traffic_limit_bytes: usageMetered
          ? Math.round(Math.max(0, Number(editor.limit)) * 1024 ** 3)
          : 0,
        renewal_interval_days: usageMetered
          ? Math.max(0, Number(editor.renewal) || 0)
          : 0,
        note: editor.note,
      };
      if (editor.id) {
        body.expires_at = editor.expiry
          ? new Date(editor.expiry).toISOString()
          : null;
        await api(`/clients/${editor.id}/`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setMsg("Client updated and Xray redeployed.");
      } else {
        const d = Math.max(0, Number(editor.days) || 0);
        body.expires_at =
          d > 0 ? new Date(Date.now() + d * 86400000).toISOString() : null;
        body.enabled = true;
        await api("/clients/", { method: "POST", body: JSON.stringify(body) });
        setMsg("Client created and Xray redeployed.");
      }
      setEditor(null);
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(c: ClientItem) {
    try {
      await api(`/clients/${c.id}/toggle/`, { method: "POST" });
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function reset(c: ClientItem) {
    try {
      await api(`/clients/${c.id}/reset-usage/`, { method: "POST" });
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function remove(c: ClientItem) {
    if (!confirm(`Delete ${c.name}?`)) return;
    try {
      await api(`/clients/${c.id}/`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function bulk(action: "enable" | "disable" | "reset" | "delete") {
    const targets = items.filter((c) => selected.has(c.id));
    if (!targets.length) return;
    if (
      action === "delete" &&
      !confirm(`Delete ${targets.length} selected clients?`)
    )
      return;
    setBusy(true);
    try {
      for (const c of targets) {
        if (action === "reset")
          await api(`/clients/${c.id}/reset-usage/`, { method: "POST" });
        else if (action === "delete")
          await api(`/clients/${c.id}/`, { method: "DELETE" });
        else if (
          (action === "enable" && !c.enabled) ||
          (action === "disable" && c.enabled)
        )
          await api(`/clients/${c.id}/toggle/`, { method: "POST" });
      }
      setSelected(new Set());
      setMsg(`${targets.length} clients updated.`);
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Manage credentials, quotas, expiry, renewals and subscriptions."
        actions={
          <Button onClick={openCreate} disabled={!inbounds.length}>
            <Plus className="h-3.5 w-3.5" />
            Add client
          </Button>
        }
      />
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border px-3 py-2.5 text-[12px] ${msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("error") ? "border-red-500/20 bg-red-500/8 text-red-500" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-strong)]"}`}
        >
          {msg}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Mini
          title="Total clients"
          value={String(items.length)}
          detail={`${active} active`}
          icon="users"
        />
        <Mini
          title="Recorded traffic"
          value={fmt(total)}
          detail="Across all clients"
          icon="chart-area"
        />
        <Mini
          title="Quota managed"
          value={String(limited)}
          detail={`${items.length - limited} unlimited`}
          icon="gauge-high"
        />
        <Mini
          title="Inbounds"
          value={String(inbounds.length)}
          detail="Available client targets"
          icon="diagram-project"
        />
      </section>
      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Client directory</CardTitle>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {filtered.length} of {items.length} clients
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <div className="relative min-w-[210px] flex-1 lg:w-64 lg:flex-none">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
              <input
                className="input h-9 pl-8"
                placeholder="Search clients..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="input h-9 w-auto min-w-[120px]"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <select
              className="input h-9 w-auto min-w-[150px]"
              value={inboundFilter}
              onChange={(e) => setInboundFilter(e.target.value)}
            >
              <option value="all">All inbounds</option>
              {inbounds.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
            <div className="text-[11px] font-medium">
              {selected.size} selected
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk("enable")}
                disabled={busy}
              >
                <Play className="h-3.5 w-3.5" />
                Enable
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk("disable")}
                disabled={busy}
              >
                <Pause className="h-3.5 w-3.5" />
                Disable
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulk("reset")}
                disabled={busy}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset usage
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => bulk("delete")}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        )}
        <CardContent className="p-0">
          <div className="hidden md:block table-wrap">
            <table className="data-table min-w-[1040px]">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allVisible}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Client</th>
                  <th>Inbound</th>
                  <th>Traffic</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th>Subscription</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const p = c.traffic_limit_bytes
                    ? Math.min(
                        100,
                        (c.used_traffic_bytes / c.traffic_limit_bytes) * 100,
                      )
                    : 0;
                  return (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                        />
                      </td>
                      <td>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--fg)]">
                            {c.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--fg)]">
                              {c.name}
                            </div>
                            <div className="mt-0.5 truncate text-[9px] text-[var(--muted)]">
                              {c.node_name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="font-medium text-[var(--fg)]">
                          {c.inbound_name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--muted)]">
                          <span>{c.protocol?.toUpperCase()}</span>
                          <span>·</span>
                          <span>ID {c.inbound}</span>
                        </div>
                      </td>
                      <td>
                        {c.usage_metered ? (
                          <div className="min-w-[150px]">
                            <div className="flex justify-between gap-3 text-[10px]">
                              <span className="font-medium text-[var(--fg)]">
                                {fmt(c.used_traffic_bytes)}
                              </span>
                              <span>
                                {c.traffic_limit_bytes
                                  ? fmt(c.traffic_limit_bytes)
                                  : "Unlimited"}
                              </span>
                            </div>
                            {c.traffic_limit_bytes > 0 ? (
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                                <div
                                  className={`h-full rounded-full ${p >= 90 ? "bg-red-500" : p >= 70 ? "bg-amber-500" : "bg-[var(--brand)]"}`}
                                  style={{ width: `${p}%` }}
                                />
                              </div>
                            ) : (
                              <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-3)]" />
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] text-[var(--muted)]">
                            Not metered per user
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="font-medium text-[var(--fg)]">
                          {expiry(c.expires_at)}
                        </div>
                        <div className="mt-0.5 text-[9px] text-[var(--muted)]">
                          {c.expires_at
                            ? new Date(c.expires_at).toLocaleDateString()
                            : "No expiry"}
                        </div>
                      </td>
                      <td>
                        <Badge tone={c.enabled ? "green" : "amber"}>
                          {c.enabled
                            ? "Active"
                            : c.disabled_reason || "Disabled"}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <Button
                            title="Copy subscription"
                            variant="outline"
                            size="icon"
                            onClick={() => copy(c)}
                          >
                            {copied === c.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            title="Open subscription portal"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              window.open(
                                c.subscription_portal_url || c.subscription_url,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className="relative">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setMenu(menu === c.id ? null : c.id)}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        {menu === c.id && (
                          <div className="absolute right-3 top-10 z-20 w-44 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl">
                            <MenuItem
                              icon="pen"
                              label="Edit"
                              onClick={() => {
                                setMenu(null);
                                openEdit(c);
                              }}
                            />
                            <MenuItem
                              icon={c.enabled ? "pause" : "play"}
                              label={c.enabled ? "Disable" : "Enable"}
                              onClick={() => {
                                setMenu(null);
                                toggle(c);
                              }}
                            />
                            <MenuItem
                              icon="rotate-left"
                              label="Reset usage"
                              onClick={() => {
                                setMenu(null);
                                reset(c);
                              }}
                            />
                            <div className="my-1 h-px bg-[var(--border)]" />
                            <MenuItem
                              icon="trash"
                              label="Delete"
                              danger
                              onClick={() => {
                                setMenu(null);
                                remove(c);
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-[var(--border)] md:hidden">
            {filtered.map((c) => {
              const p = c.traffic_limit_bytes
                ? Math.min(
                    100,
                    (c.used_traffic_bytes / c.traffic_limit_bytes) * 100,
                  )
                : 0;
              return (
                <div key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">
                        {c.name}
                      </div>
                      <div className="mt-1 truncate text-[10px] text-[var(--muted)]">
                        {c.node_name} · {c.inbound_name}
                      </div>
                    </div>
                    <Badge tone={c.enabled ? "green" : "amber"}>
                      {c.enabled ? "Active" : c.disabled_reason || "Disabled"}
                    </Badge>
                  </div>
                  <div className="mt-4">
                    {c.usage_metered ? (
                      <>
                        <div className="flex justify-between text-[10px]">
                          <span>{fmt(c.used_traffic_bytes)}</span>
                          <span>
                            {c.traffic_limit_bytes
                              ? fmt(c.traffic_limit_bytes)
                              : "Unlimited"}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-3)]">
                          <div
                            className="h-full rounded-full bg-[var(--brand)]"
                            style={{
                              width: `${c.traffic_limit_bytes ? p : 0}%`,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-[10px] text-[var(--muted)]">
                        This protocol is not metered per managed account.
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copy(c)}>
                      <Copy className="h-3.5 w-3.5" />
                      Copy sub
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(c)}>
                      {c.enabled ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {c.enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {!filtered.length && (
            <div className="grid place-items-center p-12 text-center">
              <Users className="mb-3 h-6 w-6 text-[var(--muted)]" />
              <div className="text-[13px] font-medium">No clients found</div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">
                Change the filters or create your first client.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {editor && (
        <ClientModal
          editor={editor}
          setEditor={setEditor}
          inbounds={inbounds}
          onSubmit={save}
          busy={busy}
        />
      )}
    </div>
  );
}

function Mini({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-[10px] text-[var(--muted)]">{title}</div>
          <div className="mt-1.5 text-[21px] font-semibold tracking-[-.03em]">
            {value}
          </div>
          <div className="mt-1 text-[9px] text-[var(--muted)]">{detail}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--muted-strong)]">
          <FaIcon icon={icon} />
        </div>
      </CardContent>
    </Card>
  );
}
function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[11px] ${danger ? "text-red-500 hover:bg-red-500/8" : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"}`}
    >
      <FaIcon icon={icon} className="text-[10px]" />
      {label}
    </button>
  );
}
function ClientModal({
  editor,
  setEditor,
  inbounds,
  onSubmit,
  busy,
}: {
  editor: Editor;
  setEditor: (e: Editor | null) => void;
  inbounds: InboundItem[];
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
}) {
  const set = (k: keyof Editor, v: string) => setEditor({ ...editor, [k]: v });
  const ib = inbounds.find((i) => String(i.id) === editor.inbound);
  const usageMetered =
    !ib || !["http", "socks", "tunnel", "tun"].includes(ib.protocol);
  return (
    <Dialog
      label={editor.id ? "Edit client" : "Add client"}
      onClose={() => {
        if (!busy) setEditor(null);
      }}
    >
      <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
        <div>
          <div className="text-[14px] font-semibold">
            {editor.id ? "Edit client" : "Add client"}
          </div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">
            Changes are validated and deployed to Xray automatically.
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setEditor(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <form onSubmit={onSubmit}>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="label sm:col-span-2">
            Client name
            <input
              className="input"
              value={editor.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Arman - iPhone"
              required
            />
          </label>
          <label className="label sm:col-span-2">
            Inbound
            <select
              className="input"
              value={editor.inbound}
              onChange={(e) => set("inbound", e.target.value)}
              required
            >
              <option value="">Select inbound</option>
              {inbounds.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.node_name} · {i.name} · {i.protocol.toUpperCase()}:{i.port}
                </option>
              ))}
            </select>
          </label>
          {!usageMetered && (
            <div className="sm:col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-[10px] leading-5 text-amber-600 dark:text-amber-400">
              Per-client traffic is unavailable for this protocol. Use unlimited
              traffic and no quota renewal.
            </div>
          )}
          <label className="label">
            Traffic limit (GB)
            <input
              className="input"
              type="number"
              min="0"
              step=".1"
              value={usageMetered ? editor.limit : "0"}
              onChange={(e) => set("limit", e.target.value)}
              disabled={!usageMetered}
            />
            <span className="mt-1.5 block text-[9px] font-normal text-[var(--muted)]">
              {usageMetered
                ? "0 means unlimited."
                : "Per-user metering unavailable for this protocol."}
            </span>
          </label>
          {editor.id ? (
            <label className="label">
              Expires at
              <input
                className="input"
                type="datetime-local"
                value={editor.expiry}
                onChange={(e) => set("expiry", e.target.value)}
              />
            </label>
          ) : (
            <label className="label">
              Expiry after (days)
              <input
                className="input"
                type="number"
                min="0"
                value={editor.days}
                onChange={(e) => set("days", e.target.value)}
              />
              <span className="mt-1.5 block text-[9px] font-normal text-[var(--muted)]">
                0 means no expiry.
              </span>
            </label>
          )}
          <label className="label">
            Quota renewal (days)
            <input
              className="input"
              type="number"
              min="0"
              value={usageMetered ? editor.renewal : "0"}
              onChange={(e) => set("renewal", e.target.value)}
              disabled={!usageMetered}
            />
            <span className="mt-1.5 block text-[9px] font-normal text-[var(--muted)]">
              {usageMetered
                ? "Reset used traffic automatically."
                : "Disabled without per-user metering."}
            </span>
          </label>
          <label className="label sm:col-span-2">
            Note
            <textarea
              className="input"
              value={editor.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="Optional internal note"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button variant="outline" onClick={() => setEditor(null)}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || !editor.name || !editor.inbound}
          >
            {busy ? "Saving…" : editor.id ? "Save changes" : "Create client"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
