import { useEffect, useMemo, useState } from "react";
import { api, type NodeItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { FaIcon } from "@/components/ui/fa-icon";

type Preview = { node: string; config: Record<string, unknown> };
type XrayStatus = { installed: boolean; running: boolean; version: string };

export function XrayPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [nodeId, setNodeId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<XrayStatus | null>(null);
  const [patch, setPatch] = useState("{}");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadNodes() {
    const list = await api<NodeItem[]>("/nodes/");
    setNodes(list);
    const preferred = list.find((x) => x.is_local) || list[0];
    if (preferred && !nodeId) setNodeId(String(preferred.id));
  }
  async function refresh(id = nodeId) {
    if (!id) return;
    setBusy(true);
    try {
      const [p, s] = await Promise.all([
        api<Preview>(`/nodes/${id}/config-preview/`),
        api<XrayStatus>(`/nodes/${id}/xray-status/`),
      ]);
      setPreview(p);
      setStatus(s);
      const n = nodes.find((x) => String(x.id) === id);
      if (n) setPatch(JSON.stringify(n.config_patch || {}, null, 2));
      setMsg("");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    loadNodes().catch((e) => setMsg(e.message));
  }, []);
  useEffect(() => {
    if (nodeId) refresh(nodeId);
  }, [nodeId, nodes.length]);
  const selected = useMemo(
    () => nodes.find((x) => String(x.id) === nodeId),
    [nodes, nodeId],
  );
  async function savePatch() {
    if (!selected) return;
    setBusy(true);
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(patch || "{}");
      } catch {
        throw new Error("Advanced patch must be valid JSON.");
      }
      if (
        Array.isArray(parsed) ||
        parsed === null ||
        typeof parsed !== "object"
      )
        throw new Error("Advanced patch must be a JSON object.");
      await api(`/nodes/${selected.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ config_patch: parsed }),
      });
      await loadNodes();
      await refresh(String(selected.id));
      setMsg("Advanced patch saved, validated and deployed.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function deploy() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/nodes/${selected.id}/deploy/`, { method: "POST" });
      setMsg("Generated config validated and deployed.");
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function restart() {
    if (!selected) return;
    if (
      !confirm(
        `Restart Xray on ${selected.name}? Active connections may briefly reconnect.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/nodes/${selected.id}/xray-restart/`, { method: "POST" });
      setMsg("Xray restarted.");
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copyConfig() {
    if (!preview) return;
    await navigator.clipboard.writeText(
      JSON.stringify(preview.config, null, 2),
    );
    setMsg("Generated Xray config copied.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Xray Core"
        description="Inspect generated configuration, apply advanced patches, deploy and restart each node."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => refresh()}
              disabled={busy || !nodeId}
            >
              <FaIcon icon="rotate" />
              Refresh
            </Button>
            <Button onClick={deploy} disabled={busy || !nodeId}>
              <FaIcon icon="rocket" />
              Deploy
            </Button>
          </div>
        }
      />
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[12px] text-[var(--muted-strong)]"
        >
          {msg}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Runtime</CardTitle>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Select a node.
                </p>
              </div>
              <FaIcon icon="microchip" className="text-[var(--muted)]" />
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="label">
                Node
                <select
                  className="input"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.is_local ? "★ " : ""}
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
                    Service
                  </div>
                  <div className="mt-2">
                    <Badge tone={status?.running ? "green" : "red"}>
                      {status?.running ? "Running" : "Stopped"}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
                    Version
                  </div>
                  <div className="mt-2 truncate text-[11px] font-semibold">
                    {status?.version || "—"}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={restart}
                disabled={!selected || busy}
              >
                <FaIcon icon="power-off" />
                Restart Xray
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Advanced merge patch</CardTitle>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Add DNS, routing and outbound settings. Xray validates the
                  result before applying it.
                </p>
              </div>
              <FaIcon icon="code" className="text-[var(--info)]" />
            </CardHeader>
            <CardContent>
              <textarea
                className="input mono min-h-[280px] text-[10px] leading-5"
                spellCheck={false}
                value={patch}
                onChange={(e) => setPatch(e.target.value)}
              />
              <div className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-[10px] leading-5 text-[var(--muted-strong)]">
                <FaIcon
                  icon="triangle-exclamation"
                  className="mr-1 text-amber-500"
                />
                The patch is merged into VeloRay's generated config. The local
                stats API and traffic counters stay enabled.
              </div>
              <Button
                className="mt-3 w-full"
                onClick={savePatch}
                disabled={!selected || busy}
              >
                <FaIcon icon="floppy-disk" />
                Save, validate & deploy
              </Button>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Generated config preview</CardTitle>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                This is the exact JSON VeloRay will send to the selected Agent.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={copyConfig}
              disabled={!preview}
            >
              <FaIcon icon="copy" family="regular" />
              Copy
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="m-0 max-h-[760px] overflow-auto p-5 text-[10px] leading-5 text-[var(--muted-strong)]">
              <code>
                {preview
                  ? JSON.stringify(preview.config, null, 2)
                  : "Select a node to preview configuration."}
              </code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
