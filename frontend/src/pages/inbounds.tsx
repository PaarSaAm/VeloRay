import { Dialog } from "@/components/common/dialog";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Copy,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plus,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  type InboundItem,
  type NodeItem,
  type PortReport,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { FaIcon } from "@/components/ui/fa-icon";
import { cn } from "@/lib/cn";

type FormState = {
  node: string;
  name: string;
  listen: string;
  port: string;
  protocol: string;
  transport: string;
  security: string;
  flow: string;
  path: string;
  host_header: string;
  service_name: string;
  tls_server_name: string;
  tls_cert_file: string;
  tls_key_file: string;
  reality_dest: string;
  reality_server_name: string;
  reality_private_key: string;
  reality_public_key: string;
  reality_short_id: string;
  wg_secret_key: string;
  wg_public_key: string;
  wg_mtu: string;
  wg_dns: string;
  socks_udp: boolean;
  ss_method: string;
  hy_udp_idle: string;
  hy_masquerade: string;
  tunnel_network: string;
  tunnel_address: string;
  tunnel_port: string;
  tunnel_redirect: boolean;
  tun_name: string;
  tun_mtu: string;
  tun_gateway: string;
  tun_dns: string;
  tun_routes: string;
  tun_interface: string;
  stream_json: string;
};
const fresh = (node = ""): FormState => ({
  node,
  name: "Main",
  listen: "0.0.0.0",
  port: "443",
  protocol: "vless",
  transport: "raw",
  security: "reality",
  flow: "xtls-rprx-vision",
  path: "/",
  host_header: "",
  service_name: "",
  tls_server_name: "",
  tls_cert_file: "",
  tls_key_file: "",
  reality_dest: "www.cloudflare.com:443",
  reality_server_name: "www.cloudflare.com",
  reality_private_key: "",
  reality_public_key: "",
  reality_short_id: "",
  wg_secret_key: "",
  wg_public_key: "",
  wg_mtu: "1420",
  wg_dns: "1.1.1.1",
  socks_udp: true,
  ss_method: "aes-256-gcm",
  hy_udp_idle: "60",
  hy_masquerade: "",
  tunnel_network: "tcp",
  tunnel_address: "localhost",
  tunnel_port: "0",
  tunnel_redirect: false,
  tun_name: "veloray-tun0",
  tun_mtu: "1500",
  tun_gateway: "10.66.0.1/16",
  tun_dns: "1.1.1.1,8.8.8.8",
  tun_routes: "",
  tun_interface: "auto",
  stream_json: "{}",
});
function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`label ${className}`}>
      {label}
      {children}
    </label>
  );
}
function Choice({
  value,
  label,
  active,
  disabled,
  onClick,
}: {
  value: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: (v: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(value)}
      className={cn(
        "min-h-10 rounded-lg border px-2.5 text-[10px] font-semibold transition",
        active
          ? "border-[var(--brand)] bg-[var(--surface-2)] text-[var(--brand)] shadow-[0_0_0_3px_var(--ring)]"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-strong)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]",
        "disabled:cursor-not-allowed disabled:opacity-35",
      )}
    >
      {label}
    </button>
  );
}

const protocolOptions = [
  ["vless", "VLESS", "bolt"],
  ["vmess", "VMess", "v"],
  ["trojan", "Trojan", "shield"],
  ["shadowsocks", "Shadowsocks", "ghost"],
  ["hysteria", "Hysteria2", "gauge-high"],
  ["wireguard", "WireGuard", "link"],
  ["http", "HTTP Proxy", "globe"],
  ["socks", "SOCKS5", "socks"],
  ["tunnel", "Tunnel", "arrows-left-right-to-line"],
  ["tun", "TUN", "network-wired"],
] as const;
const transportOptions = [
  ["raw", "RAW / TCP"],
  ["ws", "WebSocket"],
  ["grpc", "gRPC"],
  ["xhttp", "XHTTP"],
  ["httpupgrade", "HTTPUpgrade"],
  ["mkcp", "mKCP"],
] as const;

export function InboundsPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]),
    [items, setItems] = useState<InboundItem[]>([]),
    [form, setForm] = useState<FormState>(fresh()),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<InboundItem | null>(null);
  const [cloning, setCloning] = useState<InboundItem | null>(null),
    [cloneNode, setCloneNode] = useState(""),
    [clonePort, setClonePort] = useState(""),
    [cloneName, setCloneName] = useState(""),
    [cloneBusy, setCloneBusy] = useState(false);
  const [portResult, setPortResult] = useState("");
  const [portBusy, setPortBusy] = useState(false);
  const [portSignature, setPortSignature] = useState("");
  const signature = JSON.stringify([
    editing?.id || 0,
    form.node,
    form.listen,
    form.port,
    form.protocol,
    form.transport,
    form.socks_udp,
    form.tunnel_network,
  ]);
  function preset(value: string) {
    if (!value) return;
    const next = fresh(form.node);
    if (value === "reality") {
      next.name = "VLESS REALITY";
      next.port = "2053";
    } else if (value === "websocket") {
      next.name = "VLESS WebSocket";
      next.port = "2083";
      next.transport = "ws";
      next.security = "tls";
      next.flow = "";
      next.path = "/vpn";
    } else if (value === "trojan") {
      next.name = "Trojan TLS";
      next.port = "2087";
      next.protocol = "trojan";
      next.security = "tls";
      next.flow = "";
    } else if (value === "wireguard") {
      next.name = "WireGuard";
      next.port = "51820";
      next.protocol = "wireguard";
      next.security = "none";
      next.flow = "";
    } else if (value === "hysteria") {
      next.name = "Hysteria2";
      next.port = "4443";
      next.protocol = "hysteria";
      next.transport = "hysteria";
      next.security = "tls";
      next.flow = "";
    }
    setForm(next);
    setPortResult("");
    setMsg(
      next.security === "tls"
        ? "Set the server name and certificate paths, then check the port."
        : "Generate the server keypair, then check the port.",
    );
  }
  async function checkPort() {
    const snapshot = signature;
    setPortBusy(true);
    setPortSignature(snapshot);
    try {
      const result = await api<PortReport>(
        `/nodes/${form.node}/check-listener/`,
        {
          method: "POST",
          body: JSON.stringify({ ...payload(), id: editing?.id || 0 }),
        },
      );
      const conflicts = result.ports.filter((p) => p.state === "conflict");
      setPortResult(
        conflicts.length
          ? conflicts
              .map(
                (p) =>
                  `${p.network.toUpperCase()} :${p.port} — ${p.owner || "occupied"}`,
              )
              .join(" · ")
          : "Port check passed. Availability is checked again before deployment.",
      );
    } catch (error: unknown) {
      setPortResult(
        error instanceof Error ? error.message : "Port check failed.",
      );
    } finally {
      setPortBusy(false);
    }
  }
  const load = async () => {
    const [n, i] = await Promise.all([
      api<NodeItem[]>("/nodes/"),
      api<InboundItem[]>("/inbounds/"),
    ]);
    setNodes(n);
    setItems(i);
    setForm((f) =>
      f.node
        ? f
        : { ...f, node: String((n.find((x) => x.is_local) || n[0])?.id || "") },
    );
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);
  function set(k: keyof FormState, v: any) {
    setForm((f) => {
      const n: any = { ...f, [k]: v };
      if (k === "protocol") {
        if (v === "shadowsocks" || v === "socks") {
          n.transport = "raw";
          n.security = "none";
          n.flow = "";
        } else if (v === "wireguard") {
          n.transport = "raw";
          n.security = "none";
          n.flow = "";
        } else if (v === "tunnel") {
          n.transport = "raw";
          n.security = "none";
          n.flow = "";
          if (n.port === "0") n.port = "443";
        } else if (v === "tun") {
          n.transport = "raw";
          n.security = "none";
          n.flow = "";
          n.port = "0";
        } else if (v === "hysteria") {
          n.transport = "hysteria";
          n.security = "tls";
          n.flow = "";
        } else if (v !== "vless" && n.security === "reality") {
          n.security = "none";
          n.flow = "";
        }
      }
      if (k === "transport" && v !== "raw") n.flow = "";
      if (k === "security" && v !== "reality") n.flow = "";
      if (
        n.protocol === "vless" &&
        n.transport === "raw" &&
        n.security === "reality" &&
        !n.flow
      )
        n.flow = "xtls-rprx-vision";
      return n;
    });
  }
  async function realityKeys() {
    if (!form.node) return;
    setBusy(true);
    try {
      const k: any = await api(`/nodes/${form.node}/reality-keypair/`, {
        method: "POST",
      });
      setForm((f) => ({
        ...f,
        reality_private_key: k.private_key,
        reality_public_key: k.public_key,
      }));
      setMsg("REALITY key pair generated.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function wgKeys() {
    if (!form.node) return;
    setBusy(true);
    try {
      const k: any = await api(`/nodes/${form.node}/wireguard-keypair/`, {
        method: "POST",
      });
      setForm((f) => ({
        ...f,
        wg_secret_key: k.private_key,
        wg_public_key: k.public_key,
      }));
      setMsg("WireGuard server key pair generated.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  function payload() {
    const p: any = {
      node: Number(form.node),
      name: form.name,
      listen: form.listen,
      port: Number(form.port),
      protocol: form.protocol,
      transport: form.transport,
      security: form.security,
      flow: form.flow,
      path: form.path,
      host_header: form.host_header,
      service_name: form.service_name,
      tls_server_name: form.tls_server_name,
      tls_cert_file: form.tls_cert_file,
      tls_key_file: form.tls_key_file,
      reality_dest: form.reality_dest,
      reality_server_name: form.reality_server_name,
      reality_private_key: form.reality_private_key,
      reality_public_key: form.reality_public_key,
      reality_short_id: form.reality_short_id,
      enabled: editing?.enabled ?? true,
      protocol_settings: { ...(editing?.protocol_settings || {}) },
      stream_settings: JSON.parse(form.stream_json || "{}"),
    };
    if (form.protocol === "wireguard")
      p.protocol_settings = {
        secret_key: form.wg_secret_key,
        public_key: form.wg_public_key,
        mtu: Number(form.wg_mtu || 1420),
        dns: form.wg_dns || "1.1.1.1",
      };
    if (form.protocol === "socks")
      p.protocol_settings = {
        udp: form.socks_udp,
        udp_ip:
          nodes.find((n) => String(n.id) === form.node)?.public_host || "",
      };
    if (form.protocol === "shadowsocks")
      p.protocol_settings = { method: form.ss_method };
    if (form.protocol === "hysteria")
      p.protocol_settings = {
        udp_idle_timeout: Number(form.hy_udp_idle || 60),
        masquerade_url: form.hy_masquerade,
      };
    if (form.protocol === "tunnel")
      p.protocol_settings = {
        allowed_network: form.tunnel_network,
        rewrite_address: form.tunnel_address || "localhost",
        rewrite_port: Number(form.tunnel_port || 0),
        follow_redirect: form.tunnel_redirect,
      };
    if (form.protocol === "tun")
      p.protocol_settings = {
        name: form.tun_name || "veloray-tun0",
        mtu: Number(form.tun_mtu || 1500),
        gateway: form.tun_gateway,
        dns: form.tun_dns,
        auto_routes: form.tun_routes,
        outbound_interface: form.tun_interface || "auto",
      };
    if (p.security !== "reality")
      for (const k of [
        "reality_dest",
        "reality_server_name",
        "reality_private_key",
        "reality_public_key",
        "reality_short_id",
      ])
        p[k] = "";
    if (p.security !== "tls")
      for (const k of ["tls_server_name", "tls_cert_file", "tls_key_file"])
        p[k] = "";
    return p;
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      if (editing) {
        await api(`/inbounds/${editing.id}/`, {
          method: "PATCH",
          body: JSON.stringify(payload()),
        });
        setMsg("Inbound updated, validated and deployed.");
      } else {
        await api("/inbounds/", {
          method: "POST",
          body: JSON.stringify(payload()),
        });
        setMsg("Inbound created, validated and deployed.");
      }
      const keep = form.node;
      setEditing(null);
      setForm(fresh(keep));
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  function beginEdit(i: InboundItem) {
    const ps = i.protocol_settings || {};
    setEditing(i);
    setForm({
      node: String(i.node),
      name: i.name,
      listen: i.listen || "0.0.0.0",
      port: String(i.port),
      protocol: i.protocol,
      transport: i.transport,
      security: i.security,
      flow: i.flow || "",
      path: i.path || "/",
      host_header: i.host_header || "",
      service_name: i.service_name || "",
      tls_server_name: i.tls_server_name || "",
      tls_cert_file: i.tls_cert_file || "",
      tls_key_file: i.tls_key_file || "",
      reality_dest: i.reality_dest || "",
      reality_server_name: i.reality_server_name || "",
      reality_private_key: i.reality_private_key || "",
      reality_public_key: i.reality_public_key || "",
      reality_short_id: i.reality_short_id || "",
      wg_secret_key: String(ps.secret_key || ""),
      wg_public_key: String(ps.public_key || ""),
      wg_mtu: String(ps.mtu || 1420),
      wg_dns: String(ps.dns || "1.1.1.1"),
      socks_udp: ps.udp !== false,
      ss_method: String(ps.method || "aes-256-gcm"),
      hy_udp_idle: String(ps.udp_idle_timeout || 60),
      hy_masquerade: String(ps.masquerade_url || ""),
      tunnel_network: String(ps.allowed_network || "tcp"),
      tunnel_address: String(ps.rewrite_address || "localhost"),
      tunnel_port: String(ps.rewrite_port || 0),
      tunnel_redirect: Boolean(ps.follow_redirect),
      tun_name: String(ps.name || "veloray-tun0"),
      tun_mtu: String(ps.mtu || 1500),
      tun_gateway: Array.isArray(ps.gateway)
        ? ps.gateway.join(", ")
        : String(ps.gateway || "10.66.0.1/16"),
      tun_dns: Array.isArray(ps.dns)
        ? ps.dns.join(", ")
        : String(ps.dns || "1.1.1.1,8.8.8.8"),
      tun_routes: Array.isArray(ps.auto_routes)
        ? ps.auto_routes.join(", ")
        : String(ps.auto_routes || ""),
      tun_interface: String(ps.outbound_interface || "auto"),
      stream_json: JSON.stringify(i.stream_settings || {}, null, 2),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelEdit() {
    const node = form.node;
    setEditing(null);
    setForm(fresh(node));
  }
  async function deploy(i: InboundItem) {
    try {
      setMsg("Deploying…");
      await api(`/nodes/${i.node}/deploy/`, { method: "POST" });
      setMsg(`${i.node_name} validated and deployed.`);
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function toggle(i: InboundItem) {
    try {
      await api(`/inbounds/${i.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !i.enabled }),
      });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function remove(i: InboundItem) {
    if (!confirm(`Delete inbound ${i.name}?`)) return;
    try {
      await api(`/inbounds/${i.id}/`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  function beginClone(i: InboundItem) {
    setCloning(i);
    setCloneNode(String(i.node));
    setClonePort(
      i.protocol === "tun" ? "0" : String(Math.min(65535, i.port + 1)),
    );
    setCloneName(`${i.name} copy`);
  }
  async function clone() {
    if (!cloning || cloneBusy) return;
    setCloneBusy(true);
    try {
      await api(`/inbounds/${cloning.id}/clone/`, {
        method: "POST",
        body: JSON.stringify({
          node: Number(cloneNode),
          port: Number(clonePort),
          name: cloneName,
        }),
      });
      setCloning(null);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setCloneBusy(false);
    }
  }
  const reality = form.security === "reality",
    tls = form.security === "tls",
    vision = form.protocol === "vless" && form.transport === "raw" && reality;
  const plaintext = form.protocol === "http" || form.protocol === "socks";
  const protocolCounts = useMemo(
    () =>
      Object.fromEntries(
        protocolOptions.map(([p]) => [
          p,
          items.filter((i) => i.protocol === p).length,
        ]),
      ),
    [items],
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbounds"
        description="Connection protocols, ports and server credentials."
      />
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[11px] text-[var(--muted-strong)]"
        >
          <FaIcon icon="circle-info" className="mt-0.5 text-[var(--info)]" />
          {msg}
        </div>
      )}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
        {protocolOptions.map(([p, label, icon]) => (
          <div
            key={p}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
          >
            <div className="flex items-center justify-between">
              <FaIcon icon={icon} className="text-[var(--muted)]" />
              <span className="text-[16px] font-semibold">
                {protocolCounts[p] || 0}
              </span>
            </div>
            <div className="mt-2 truncate text-[9px] text-[var(--muted)]">
              {label}
            </div>
          </div>
        ))}
      </section>
      <div className="grid gap-4 2xl:grid-cols-[520px_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{editing ? "Edit inbound" : "New inbound"}</CardTitle>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Only combinations validated by VeloRay are deployable.
              </p>
            </div>
            {editing && (
              <Button variant="ghost" size="icon" onClick={cancelEdit}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-5">
              {!editing && (
                <label className="label">
                  Connection preset
                  <select
                    className="input"
                    aria-label="Connection preset"
                    value=""
                    onChange={(e) => preset(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">Choose a starting point</option>
                    <option value="reality">VLESS · REALITY · Vision</option>
                    <option value="websocket">VLESS · WebSocket · TLS</option>
                    <option value="trojan">Trojan · TLS</option>
                    <option value="wireguard">WireGuard · UDP</option>
                    <option value="hysteria">Hysteria2 · UDP · TLS</option>
                  </select>
                </label>
              )}
              <section>
                <div className="panel-section-title mb-3">Listener</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Node" className="sm:col-span-2">
                    <select
                      className="input"
                      value={form.node}
                      onChange={(e) => set("node", e.target.value)}
                      required
                    >
                      <option value="">Select node</option>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.is_local ? "★ " : ""}
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Name">
                    <input
                      className="input"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      required
                    />
                  </Field>
                  <Field
                    label={form.protocol === "tun" ? "Port (not used)" : "Port"}
                  >
                    <input
                      className="input"
                      type="number"
                      min={form.protocol === "tun" ? 0 : 1}
                      max="65535"
                      value={form.port}
                      onChange={(e) => set("port", e.target.value)}
                      disabled={form.protocol === "tun"}
                      required
                    />
                  </Field>
                  {form.protocol !== "tun" && (
                    <Field label="Listen address" className="sm:col-span-2">
                      <input
                        className="input"
                        value={form.listen}
                        onChange={(e) => set("listen", e.target.value)}
                        placeholder="0.0.0.0 or ::"
                        required
                      />
                      <span className="mt-1 text-[10px] font-normal text-[var(--muted)]">
                        Use 0.0.0.0 for IPv4 or :: for IPv6. Enter a specific IP
                        to restrict the listener.
                      </span>
                    </Field>
                  )}
                </div>
                {form.protocol !== "tun" && (
                  <div className="mt-3 space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkPort}
                      disabled={portBusy || busy || !form.node}
                    >
                      <FaIcon icon="shield-halved" />
                      {portBusy ? "Checking port…" : "Check port"}
                    </Button>
                    {portResult && portSignature === signature && (
                      <p
                        role="status"
                        className="break-words text-[11px] leading-5 text-[var(--muted-strong)]"
                      >
                        {portResult}
                      </p>
                    )}
                  </div>
                )}
              </section>
              <section>
                <div className="panel-section-title mb-3">Protocol</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {protocolOptions.map(([v, l]) => (
                    <Choice
                      key={v}
                      value={v}
                      label={l}
                      active={form.protocol === v}
                      onClick={(v) => set("protocol", v)}
                    />
                  ))}
                </div>
                {plaintext && (
                  <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/7 px-3 py-2 text-[10px] leading-5 text-amber-500">
                    HTTP and SOCKS are plaintext proxy protocols. Prefer
                    local/LAN use or place them behind a protected transport.
                  </div>
                )}
              </section>
              {!["wireguard", "tunnel", "tun"].includes(form.protocol) && (
                <section>
                  <div className="panel-section-title mb-3">Transport</div>
                  {form.protocol === "hysteria" ? (
                    <div className="grid grid-cols-2">
                      <Choice
                        value="hysteria"
                        label="Hysteria2 / QUIC"
                        active
                        onClick={() => {}}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {transportOptions.map(([v, l]) => (
                        <Choice
                          key={v}
                          value={v}
                          label={l}
                          active={form.transport === v}
                          disabled={
                            (form.protocol === "shadowsocks" ||
                              form.protocol === "socks") &&
                            v !== "raw"
                          }
                          onClick={(v) => set("transport", v)}
                        />
                      ))}
                    </div>
                  )}
                  {["ws", "xhttp", "httpupgrade"].includes(form.transport) && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Path">
                        <input
                          className="input"
                          value={form.path}
                          onChange={(e) => set("path", e.target.value)}
                          placeholder="/veloray"
                        />
                      </Field>
                      {["ws", "httpupgrade"].includes(form.transport) && (
                        <Field label="Host header">
                          <input
                            className="input"
                            value={form.host_header}
                            onChange={(e) => set("host_header", e.target.value)}
                            placeholder="cdn.example.com"
                          />
                        </Field>
                      )}
                    </div>
                  )}
                  {form.transport === "grpc" && (
                    <div className="mt-3">
                      <Field label="gRPC service">
                        <input
                          className="input"
                          value={form.service_name}
                          onChange={(e) => set("service_name", e.target.value)}
                          placeholder="veloray-grpc"
                        />
                      </Field>
                    </div>
                  )}
                </section>
              )}
              {!["wireguard", "tunnel", "tun"].includes(form.protocol) && (
                <section>
                  <div className="panel-section-title mb-3">Security</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["none", "None"],
                      ["tls", "TLS"],
                      ["reality", "REALITY"],
                    ].map(([v, l]) => (
                      <Choice
                        key={v}
                        value={v}
                        label={l}
                        active={form.security === v}
                        disabled={
                          (form.protocol === "hysteria" && v !== "tls") ||
                          ((form.protocol === "shadowsocks" ||
                            form.protocol === "socks") &&
                            v !== "none") ||
                          (v === "reality" &&
                            (form.protocol !== "vless" ||
                              !["raw", "grpc", "xhttp"].includes(
                                form.transport,
                              )))
                        }
                        onClick={(v) => set("security", v)}
                      />
                    ))}
                  </div>
                  {vision && (
                    <div className="mt-3">
                      <Field label="VLESS flow">
                        <select
                          className="input"
                          value={form.flow}
                          onChange={(e) => set("flow", e.target.value)}
                        >
                          <option value="xtls-rprx-vision">XTLS Vision</option>
                          <option value="">None</option>
                        </select>
                      </Field>
                    </div>
                  )}
                  {tls && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="TLS certificate">
                        <input
                          className="input"
                          value={form.tls_cert_file}
                          onChange={(e) => set("tls_cert_file", e.target.value)}
                          placeholder="/etc/letsencrypt/live/.../fullchain.pem"
                        />
                      </Field>
                      <Field label="TLS private key">
                        <input
                          className="input"
                          value={form.tls_key_file}
                          onChange={(e) => set("tls_key_file", e.target.value)}
                          placeholder="/etc/letsencrypt/live/.../privkey.pem"
                        />
                      </Field>
                      <Field label="Server name" className="sm:col-span-2">
                        <input
                          className="input"
                          value={form.tls_server_name}
                          onChange={(e) =>
                            set("tls_server_name", e.target.value)
                          }
                          placeholder="vpn.example.com"
                        />
                      </Field>
                    </div>
                  )}
                  {reality && (
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                        <div>
                          <div className="text-[11px] font-semibold">
                            REALITY identity
                          </div>
                          <div className="mt-0.5 text-[9px] text-[var(--muted)]">
                            Generate X25519 keys on the selected node.
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={realityKeys}
                          disabled={busy}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Generate
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Destination">
                          <input
                            className="input"
                            value={form.reality_dest}
                            onChange={(e) =>
                              set("reality_dest", e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Server name">
                          <input
                            className="input"
                            value={form.reality_server_name}
                            onChange={(e) =>
                              set("reality_server_name", e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Private key">
                          <input
                            className="input mono"
                            value={form.reality_private_key}
                            onChange={(e) =>
                              set("reality_private_key", e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Public key">
                          <input
                            className="input mono"
                            value={form.reality_public_key}
                            onChange={(e) =>
                              set("reality_public_key", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                </section>
              )}
              {form.protocol === "wireguard" && (
                <section>
                  <div className="panel-section-title mb-3">WireGuard</div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                    <div>
                      <div className="text-[11px] font-semibold">
                        Server key pair
                      </div>
                      <div className="mt-0.5 text-[9px] text-[var(--muted)]">
                        Generated by Xray on the selected node.
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={wgKeys}
                      disabled={busy}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Generate
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Private key">
                      <input
                        className="input mono"
                        value={form.wg_secret_key}
                        onChange={(e) => set("wg_secret_key", e.target.value)}
                      />
                    </Field>
                    <Field label="Public key">
                      <input
                        className="input mono"
                        value={form.wg_public_key}
                        onChange={(e) => set("wg_public_key", e.target.value)}
                      />
                    </Field>
                    <Field label="MTU">
                      <input
                        className="input"
                        type="number"
                        min="1200"
                        max="9000"
                        value={form.wg_mtu}
                        onChange={(e) => set("wg_mtu", e.target.value)}
                      />
                    </Field>
                    <Field label="Client DNS">
                      <input
                        className="input"
                        value={form.wg_dns}
                        onChange={(e) => set("wg_dns", e.target.value)}
                      />
                    </Field>
                  </div>
                </section>
              )}
              {form.protocol === "socks" && (
                <section>
                  <div className="panel-section-title mb-3">SOCKS options</div>
                  <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[11px]">
                    <span>Enable UDP relay</span>
                    <input
                      type="checkbox"
                      checked={form.socks_udp}
                      onChange={(e) => set("socks_udp", e.target.checked)}
                    />
                  </label>
                </section>
              )}
              {form.protocol === "shadowsocks" && (
                <section>
                  <div className="panel-section-title mb-3">Shadowsocks</div>
                  <Field label="Cipher">
                    <select
                      className="input"
                      value={form.ss_method}
                      onChange={(e) => set("ss_method", e.target.value)}
                    >
                      <option value="aes-256-gcm">AES-256-GCM</option>
                      <option value="chacha20-poly1305">
                        ChaCha20-Poly1305
                      </option>
                    </select>
                  </Field>
                </section>
              )}
              {form.protocol === "hysteria" && (
                <section>
                  <div className="panel-section-title mb-3">Hysteria2</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="UDP idle timeout">
                      <input
                        className="input"
                        type="number"
                        min="10"
                        value={form.hy_udp_idle}
                        onChange={(e) => set("hy_udp_idle", e.target.value)}
                      />
                    </Field>
                    <Field label="Masquerade URL">
                      <input
                        className="input"
                        value={form.hy_masquerade}
                        onChange={(e) => set("hy_masquerade", e.target.value)}
                        placeholder="https://example.com"
                      />
                    </Field>
                  </div>
                </section>
              )}
              {form.protocol === "tunnel" && (
                <section>
                  <div className="panel-section-title mb-3">
                    Tunnel / port forwarding
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Allowed network">
                      <select
                        className="input"
                        value={form.tunnel_network}
                        onChange={(e) => set("tunnel_network", e.target.value)}
                      >
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                        <option value="tcp,udp">TCP + UDP</option>
                      </select>
                    </Field>
                    <Field label="Rewrite address">
                      <input
                        className="input"
                        value={form.tunnel_address}
                        onChange={(e) => set("tunnel_address", e.target.value)}
                        placeholder="target.example.com"
                      />
                    </Field>
                    <Field label="Rewrite port">
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="65535"
                        value={form.tunnel_port}
                        onChange={(e) => set("tunnel_port", e.target.value)}
                      />
                    </Field>
                    <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[11px]">
                      <span>Follow redirected destination</span>
                      <input
                        type="checkbox"
                        checked={form.tunnel_redirect}
                        onChange={(e) =>
                          set("tunnel_redirect", e.target.checked)
                        }
                      />
                    </label>
                  </div>
                </section>
              )}
              {form.protocol === "tun" && (
                <section>
                  <div className="panel-section-title mb-3">TUN interface</div>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/7 px-3 py-2 text-[10px] leading-5 text-amber-500">
                    TUN changes host routing. VeloRay validates the Xray config,
                    but route design should still be tested carefully to avoid
                    loops.
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Interface name">
                      <input
                        className="input"
                        value={form.tun_name}
                        onChange={(e) => set("tun_name", e.target.value)}
                      />
                    </Field>
                    <Field label="MTU">
                      <input
                        className="input"
                        type="number"
                        min="576"
                        max="9000"
                        value={form.tun_mtu}
                        onChange={(e) => set("tun_mtu", e.target.value)}
                      />
                    </Field>
                    <Field label="Gateway CIDRs">
                      <input
                        className="input"
                        value={form.tun_gateway}
                        onChange={(e) => set("tun_gateway", e.target.value)}
                        placeholder="10.66.0.1/16"
                      />
                    </Field>
                    <Field label="DNS servers">
                      <input
                        className="input"
                        value={form.tun_dns}
                        onChange={(e) => set("tun_dns", e.target.value)}
                        placeholder="1.1.1.1, 8.8.8.8"
                      />
                    </Field>
                    <Field
                      label="Automatic route CIDRs"
                      className="sm:col-span-2"
                    >
                      <input
                        className="input"
                        value={form.tun_routes}
                        onChange={(e) => set("tun_routes", e.target.value)}
                        placeholder="0.0.0.0/0, ::/0 (optional)"
                      />
                    </Field>
                    <Field label="Outbound interface" className="sm:col-span-2">
                      <input
                        className="input"
                        value={form.tun_interface}
                        onChange={(e) => set("tun_interface", e.target.value)}
                        placeholder="auto"
                      />
                    </Field>
                  </div>
                </section>
              )}
              <details className="rounded-lg border border-[var(--border)] p-3">
                <summary className="cursor-pointer text-[12px] font-medium">
                  Advanced stream settings
                </summary>
                <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
                  Configure transport, ALPN, socket and TLS options. Ports,
                  credentials and security mode use the fields above. Xray
                  validates changes before applying them.
                </p>
                <label className="label mt-3">
                  Stream settings JSON
                  <textarea
                    className="input min-h-40 font-mono text-[11px]"
                    value={form.stream_json}
                    onChange={(e) => set("stream_json", e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </details>
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !form.node}
              >
                <Plus className="h-3.5 w-3.5" />
                {busy
                  ? "Saving…"
                  : editing
                    ? "Save & deploy"
                    : "Create & deploy"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Configured inbounds</CardTitle>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {items.length} listeners across {nodes.length} nodes
              </p>
            </div>
            <Badge tone="blue">Xray</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="hidden md:block table-wrap">
              <table className="data-table min-w-[940px]">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Node</th>
                    <th>Protocol</th>
                    <th>Transport</th>
                    <th>Security</th>
                    <th>Port</th>
                    <th>Clients</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="font-semibold text-[var(--fg)]">
                        {i.name}
                      </td>
                      <td>{i.node_name}</td>
                      <td>
                        <Badge tone="blue">
                          {i.protocol === "hysteria"
                            ? "Hysteria2"
                            : i.protocol.toUpperCase()}
                        </Badge>
                      </td>
                      <td>
                        {["wireguard", "tunnel", "tun"].includes(i.protocol)
                          ? "Native"
                          : i.transport}
                      </td>
                      <td>
                        {i.protocol === "wireguard"
                          ? "WireGuard"
                          : ["tunnel", "tun"].includes(i.protocol)
                            ? "Native"
                            : i.security}
                      </td>
                      <td className="mono">
                        {i.protocol === "tun" ? "—" : i.port}
                      </td>
                      <td>{i.client_count}</td>
                      <td>
                        <Badge tone={i.enabled ? "green" : "neutral"}>
                          {i.enabled ? "Enabled" : "Paused"}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button
                            title="Clone"
                            size="icon"
                            variant="ghost"
                            onClick={() => beginClone(i)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            title={i.enabled ? "Pause" : "Enable"}
                            size="icon"
                            variant="ghost"
                            onClick={() => toggle(i)}
                          >
                            {i.enabled ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            title="Edit"
                            size="icon"
                            variant="ghost"
                            onClick={() => beginEdit(i)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            title="Deploy"
                            size="icon"
                            variant="outline"
                            onClick={() => deploy(i)}
                          >
                            <Rocket className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            title="Delete"
                            size="icon"
                            variant="ghost"
                            onClick={() => remove(i)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!items.length && (
              <div className="p-12 text-center text-[11px] text-[var(--muted)]">
                Create your first listener on Local Node.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {cloning && (
        <Dialog label="Clone inbound" onClose={() => setCloning(null)}>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <div className="text-[14px] font-semibold">Clone inbound</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                Duplicate {cloning.name} to another node or port.
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCloning(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-3 p-5">
            <Field label="Name">
              <input
                className="input"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
              />
            </Field>
            <Field label="Node">
              <select
                className="input"
                value={cloneNode}
                onChange={(e) => setCloneNode(e.target.value)}
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Port">
              <input
                className="input"
                type="number"
                value={clonePort}
                onChange={(e) => setClonePort(e.target.value)}
                disabled={cloning.protocol === "tun"}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
            <Button variant="outline" onClick={() => setCloning(null)}>
              Cancel
            </Button>
            <Button onClick={clone} disabled={cloneBusy}>
              {cloneBusy ? "Cloning…" : "Clone & deploy"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
