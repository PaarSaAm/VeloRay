import { Textarea } from "@/components/ui/controls";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, X, Route, ArrowUpRight } from "lucide-react";
import { api, type NodeItem } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Dialog } from "@/components/common/dialog";
import { Input, Select } from "@/components/ui/controls";
import { can, useSession } from "@/lib/session";
type Entry = {
  id?: number;
  name: string;
  node: number;
  core: string;
  tag?: string;
  protocol?: string;
  priority?: number;
  enabled: boolean;
  config: Record<string, unknown>;
};
const templates: Record<string, Record<string, unknown>> = {
  freedom: { settings: {} },
  blackhole: { settings: {} },
  direct: {},
  selector: { outbounds: ["direct"], default: "direct" },
  urltest: {
    outbounds: ["direct"],
    url: "https://www.gstatic.com/generate_204",
    interval: "3m",
  },
  socks: { settings: { servers: [{ address: "", port: 443 }] } },
  http: { settings: { servers: [{ address: "", port: 443 }] } },
  trojan: { settings: { servers: [{ address: "", port: 443, password: "" }] } },
  shadowsocks: {
    settings: { servers: [{ address: "", port: 443, password: "" }] },
  },
  vless: {
    settings: {
      vnext: [
        { address: "", port: 443, users: [{ id: "", encryption: "none" }] },
      ],
    },
  },
  vmess: {
    settings: {
      vnext: [
        { address: "", port: 443, users: [{ id: "", encryption: "none" }] },
      ],
    },
  },
};
const singTemplates: Record<string, Record<string, unknown>> = {
  direct: {},
  selector: templates.selector,
  urltest: templates.urltest,
  vless: {
    server: "",
    server_port: 443,
    uuid: "",
    tls: { enabled: true, server_name: "" },
  },
  vmess: { server: "", server_port: 443, uuid: "", security: "auto" },
  trojan: {
    server: "",
    server_port: 443,
    password: "",
    tls: { enabled: true, server_name: "" },
  },
  shadowsocks: {
    server: "",
    server_port: 8388,
    method: "aes-256-gcm",
    password: "",
  },
  hysteria2: {
    server: "",
    server_port: 443,
    password: "",
    tls: { enabled: true, server_name: "" },
  },
  socks: { server: "", server_port: 1080 },
  http: { server: "", server_port: 8080 },
};
export function OutboundsPage() {
  return <NetworkPage kind="outbounds" />;
}
export function RoutingPage() {
  return <NetworkPage kind="routing_rules" />;
}
function NetworkPage({ kind }: { kind: "outbounds" | "routing_rules" }) {
  const session = useSession(),
    routing = kind === "routing_rules",
    title = routing ? t("Routing") : t("Outbounds");
  const [items, setItems] = useState<Entry[]>([]),
    [nodes, setNodes] = useState<NodeItem[]>([]),
    [editor, setEditor] = useState<Entry | null>(null),
    [text, setText] = useState("{}"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const editable = can(session, `${kind}.write`);
  async function load() {
    try {
      const [a, b] = await Promise.all([
        api<Entry[]>(`/${kind}`),
        api<NodeItem[]>("/nodes"),
      ]);
      setItems(a);
      setNodes(b);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
  }, [kind]);
  function open(item?: Entry) {
    const d = item ?? {
      name: "",
      node: nodes[0]?.id || 0,
      core: "xray",
      enabled: true,
      tag: "",
      protocol: "freedom",
      priority: 100,
      config: routing ? { outboundTag: "direct" } : { settings: {} },
    };
    setEditor(d);
    setText(JSON.stringify(d.config, null, 2));
    setError("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setBusy(true);
    try {
      const config = JSON.parse(text);
      if (!config || Array.isArray(config) || typeof config !== "object")
        throw Error(t("Enter a JSON object."));
      await api(`/${kind}/${editor.id ? editor.id + "/" : ""}`, {
        method: editor.id ? "PATCH" : "POST",
        body: JSON.stringify({
          name: editor.name,
          node: editor.node,
          core: editor.core,
          enabled: editor.enabled,
          config,
          ...(routing
            ? { priority: editor.priority }
            : { tag: editor.tag, protocol: editor.protocol }),
        }),
      });
      setEditor(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Entry) {
    if (!confirm(`${t("Delete")} ${item.name}?`)) return;
    try {
      await api(`/${kind}/${item.id}/`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  const set = (key: keyof Entry, value: any) =>
    setEditor((d) => (d ? { ...d, [key]: value } : d));
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description=""
        actions={
          editable ? (
            <Button onClick={() => open()}>
              <Plus size={15} />
              {routing ? t("New rule") : t("New outbound")}
            </Button>
          ) : undefined
        }
      />
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            {routing ? t("Rules") : t("Configured outbounds")}
          </CardTitle>
          <span className="text-xs text-[var(--muted)]">{items.length}</span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="table-wrap">
            <table className="data-table min-w-[650px]">
              <thead>
                <tr>
                  <th>{t("Name")}</th>
                  <th>{t("Node")}</th>
                  <th>{t("Core")}</th>
                  <th>{routing ? t("Priority") : t("Protocol")}</th>
                  <th>{routing ? t("Match") : t("Tag")}</th>
                  <th>{t("Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...items]
                  .sort((a, b) =>
                    routing ? (a.priority || 0) - (b.priority || 0) : 0,
                  )
                  .map((item) => (
                    <tr key={item.id}>
                      <td className="font-semibold">
                        <span className="inline-flex items-center gap-2">
                          {routing ? (
                            <Route size={14} />
                          ) : (
                            <ArrowUpRight size={14} />
                          )}{" "}
                          {item.name}
                        </span>
                      </td>
                      <td>{nodes.find((n) => n.id === item.node)?.name}</td>
                      <td>{item.core === "singbox" ? "sing-box" : "Xray"}</td>
                      <td>{routing ? item.priority : item.protocol}</td>
                      <td className="max-w-[230px] truncate">
                        {routing ? JSON.stringify(item.config) : item.tag}
                      </td>
                      <td>{item.enabled ? t("Active") : t("Disabled")}</td>
                      <td>
                        {editable && (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("Edit")}
                              onClick={() => open(item)}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("Delete")}
                              onClick={() => remove(item)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!items.length && (
              <div className="empty-state">{t("No entries yet.")}</div>
            )}
          </div>
        </CardContent>
      </Card>
      {editor && (
        <Dialog label={title} onClose={() => setEditor(null)}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold">
              {editor.id ? t("Edit") : t("Create")} {title}
            </h3>
            <Button variant="ghost" size="icon" onClick={() => setEditor(null)}>
              <X size={17} />
            </Button>
          </div>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <label className="label">
              {t("Name")}
              <Input
                className="input"
                required
                value={editor.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <label className="label">
              {t("Node")}
              <Select
                className="input"
                value={editor.node}
                onChange={(e) => set("node", Number(e.target.value))}
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="label">
              {t("Core")}
              <Select
                className="input"
                value={editor.core}
                onChange={(e) => {
                  set("core", e.target.value);
                  if (routing)
                    setText(
                      JSON.stringify(
                        e.target.value === "xray"
                          ? { outboundTag: "direct" }
                          : { action: "route", outbound: "direct" },
                        null,
                        2,
                      ),
                    );
                  else {
                    set(
                      "protocol",
                      e.target.value === "xray" ? "freedom" : "direct",
                    );
                    setText(
                      e.target.value === "xray" ? '{"settings":{}}' : "{}",
                    );
                  }
                }}
              >
                <option value="xray">Xray · Primary</option>
                <option value="singbox">sing-box</option>
              </Select>
            </label>
            {routing ? (
              <label className="label">
                {t("Priority")}
                <Input
                  className="input"
                  type="number"
                  min="0"
                  max="100000"
                  value={editor.priority}
                  onChange={(e) => set("priority", Number(e.target.value))}
                />
              </label>
            ) : (
              <>
                <label className="label">
                  {t("Tag")}
                  <Input
                    className="input"
                    required
                    pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,95}"
                    value={editor.tag}
                    onChange={(e) => set("tag", e.target.value)}
                  />
                </label>
                <label className="label">
                  {t("Protocol")}
                  <Select
                    className="input"
                    value={editor.protocol}
                    onChange={(e) => {
                      set("protocol", e.target.value);
                      setText(
                        JSON.stringify(
                          editor.core === "xray"
                            ? templates[e.target.value] || { settings: {} }
                            : singTemplates[e.target.value] || {
                                server: "",
                                server_port: 443,
                              },
                          null,
                          2,
                        ),
                      );
                    }}
                  >
                    {(editor.core === "xray"
                      ? [
                          "freedom",
                          "blackhole",
                          "vless",
                          "vmess",
                          "trojan",
                          "shadowsocks",
                          "socks",
                          "http",
                          "wireguard",
                          "dns",
                          "loopback",
                        ]
                      : [
                          "direct",
                          "selector",
                          "urltest",
                          "vless",
                          "vmess",
                          "trojan",
                          "shadowsocks",
                          "hysteria2",
                          "tuic",
                          "socks",
                          "http",

                          "ssh",
                          "anytls",
                        ]
                    ).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </label>
              </>
            )}
            {routing && (
              <div className="flex gap-2 flex-wrap sm:col-span-2">
                {["domain", "IP", "port", "source", "user"].map((field) => (
                  <Button
                    type="button"
                    key={field}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      try {
                        const cfg = JSON.parse(text),
                          x = editor.core === "xray";
                        const keys: Record<string, string> = {
                          domain: x ? "domain" : "domain_suffix",
                          IP: x ? "ip" : "ip_cidr",
                          port: "port",
                          source: x ? "source" : "source_ip_cidr",
                          user: x ? "user" : "auth_user",
                        };
                        cfg[keys[field]] =
                          field === "port" ? (x ? "443" : [443]) : [""];
                        setText(JSON.stringify(cfg, null, 2));
                      } catch {}
                    }}
                  >
                    {field}
                  </Button>
                ))}
              </div>
            )}
            <label className="label sm:col-span-2">
              {t("Configuration")}
              <Textarea
                className="input min-h-[220px] font-mono text-[11px] leading-6"
                spellCheck={false}
                dir="ltr"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label className="check-row">
              <Input
                type="checkbox"
                checked={editor.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              {t("Enabled")}
            </label>
            {error && (
              <div role="alert" className="form-error sm:col-span-2">
                {error}
              </div>
            )}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setEditor(null)}
              >
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("Saving…") : t("Save & deploy")}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
