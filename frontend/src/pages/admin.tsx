import { Dialog } from "@/components/common/dialog";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Plus, Search, Trash2, UserCog, X } from "lucide-react";
import {
  api,
  type AdminAPIKey,
  type AdminUser,
  type AppSettings,
  type SystemInfo,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { FaIcon } from "@/components/ui/fa-icon";

type Editor = {
  id?: number;
  username: string;
  email: string;
  password: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
};
type KeyEditor = {
  name: string;
  scope: "read" | "write" | "admin";
  user: string;
  days: string;
};
const blank = (): Editor => ({
  username: "",
  email: "",
  password: "",
  is_active: true,
  is_staff: true,
  is_superuser: false,
});

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]),
    [keys, setKeys] = useState<AdminAPIKey[]>([]),
    [sys, setSys] = useState<SystemInfo | null>(null),
    [cfg, setCfg] = useState<AppSettings | null>(null);
  const [query, setQuery] = useState(""),
    [editor, setEditor] = useState<Editor | null>(null),
    [keyEditor, setKeyEditor] = useState<KeyEditor | null>(null),
    [createdToken, setCreatedToken] = useState("");
  const [tab, setTab] = useState<"operators" | "api">("operators"),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [u, k, s, c] = await Promise.all([
        api<AdminUser[]>("/admin/users/"),
        api<AdminAPIKey[]>("/admin/api-keys/"),
        api<SystemInfo>("/system-info"),
        api<AppSettings>("/settings"),
      ]);
      setUsers(u);
      setKeys(k);
      setSys(s);
      setCfg(c);
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return q
      ? users.filter((u) =>
          `${u.username} ${u.email}`.toLowerCase().includes(q),
        )
      : users;
  }, [users, query]);
  function edit(u: AdminUser) {
    setEditor({
      id: u.id,
      username: u.username,
      email: u.email || "",
      password: "",
      is_active: u.is_active,
      is_staff: u.is_staff,
      is_superuser: u.is_superuser,
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setBusy(true);
    setMsg("");
    try {
      const body: any = {
        username: editor.username,
        email: editor.email,
        is_active: editor.is_active,
        is_staff: editor.is_staff,
        is_superuser: editor.is_superuser,
      };
      if (editor.password) body.password = editor.password;
      if (editor.id)
        await api(`/admin/users/${editor.id}/`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      else {
        if (!editor.password)
          throw new Error("Password is required for a new administrator.");
        await api("/admin/users/", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setEditor(null);
      setMsg("Administrator saved.");
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(u: AdminUser) {
    if (!confirm(`Delete administrator ${u.username}?`)) return;
    try {
      await api(`/admin/users/${u.id}/`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function createKey(e: FormEvent) {
    e.preventDefault();
    if (!keyEditor) return;
    setBusy(true);
    setCreatedToken("");
    try {
      const expires = new Date(
        Date.now() + Math.max(1, Number(keyEditor.days) || 90) * 86400000,
      ).toISOString();
      const out = await api<AdminAPIKey>("/admin/api-keys/", {
        method: "POST",
        body: JSON.stringify({
          name: keyEditor.name,
          scope: keyEditor.scope,
          user: Number(keyEditor.user),
          expires_at: expires,
        }),
      });
      setCreatedToken(out.token || "");
      setKeyEditor(null);
      setMsg(
        "API key created. Copy it now; the full token is shown only once.",
      );
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function revokeKey(k: AdminAPIKey) {
    if (!confirm(`Revoke API key ${k.name}?`)) return;
    try {
      await api(`/admin/api-keys/${k.id}/`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function toggleKey(k: AdminAPIKey) {
    try {
      await api(`/admin/api-keys/${k.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !k.enabled }),
      });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function copyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setMsg("API key copied.");
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="Operators, access policy and scoped API credentials."
        actions={
          <Button
            onClick={() =>
              tab === "operators"
                ? setEditor(blank())
                : setKeyEditor({
                    name: "Automation",
                    scope: "read",
                    user: String(users[0]?.id || ""),
                    days: String(cfg?.api_key_default_days || 90),
                  })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {tab === "operators" ? "Add administrator" : "Create API key"}
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
      {createdToken && (
        <Card className="border-emerald-500/30">
          <CardHeader>
            <div>
              <CardTitle>New API key</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                This secret will not be shown again.
              </p>
            </div>
            <Badge tone="green">One-time secret</Badge>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[10px]">
                {createdToken}
              </code>
              <Button variant="outline" onClick={copyToken}>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {cfg?.require_2fa_for_admins &&
        users.some((u) => u.is_staff && !u.two_factor_enabled) && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-[11px] text-amber-500">
            <div className="font-semibold">2FA policy needs attention</div>
            <div className="mt-1 text-[10px] opacity-90">
              {users.filter((u) => u.is_staff && !u.two_factor_enabled).length}{" "}
              administrator account(s) do not have TOTP enabled yet.
            </div>
          </div>
        )}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Mini
          icon="users"
          label="Panel users"
          value={String(sys?.users_total ?? users.length)}
        />
        <Mini
          icon="user-shield"
          label="Administrators"
          value={String(
            sys?.admins_total ?? users.filter((x) => x.is_staff).length,
          )}
        />
        <Mini
          icon="key"
          label="Active API keys"
          value={String(keys.filter((x) => x.enabled).length)}
        />
        <Mini
          icon="shield-halved"
          label="2FA enabled"
          value={String(users.filter((x) => x.two_factor_enabled).length)}
        />
      </section>
      <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
        {[
          ["operators", "Operators"],
          ["api", "API keys"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k as any)}
            className={`rounded-md px-3 py-2 text-[11px] font-semibold ${tab === k ? "bg-[var(--surface-2)] text-[var(--fg)]" : "text-[var(--muted)]"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "operators" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Operators</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Staff and superuser accounts that can sign in to the panel.
              </p>
            </div>
            <div className="relative w-full max-w-64">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
              <input
                className="input h-9 pl-8"
                placeholder="Search users"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="table-wrap">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>2FA</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="font-semibold text-[var(--fg)]">
                          {u.username}
                        </div>
                        <div className="mt-0.5 text-[9px] text-[var(--muted)]">
                          {u.email || "No email"}
                        </div>
                      </td>
                      <td>
                        {u.is_superuser ? (
                          <Badge tone="blue">Superuser</Badge>
                        ) : u.is_staff ? (
                          <Badge tone="neutral">Staff</Badge>
                        ) : (
                          <Badge tone="amber">Limited</Badge>
                        )}
                      </td>
                      <td>
                        <Badge tone={u.two_factor_enabled ? "green" : "amber"}>
                          {u.two_factor_enabled ? "Enabled" : "Off"}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={u.is_active ? "green" : "red"}>
                          {u.is_active ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td>
                        {u.last_login
                          ? new Date(u.last_login).toLocaleString()
                          : "Never"}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => edit(u)}
                          >
                            <UserCog className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => remove(u)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="p-12 text-center text-[11px] text-[var(--muted)]">
                No administrators found.
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Scoped API keys</CardTitle>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Use Bearer tokens for automation without sharing a panel
                password.
              </p>
            </div>
            <Badge tone={cfg?.api_keys_enabled ? "green" : "amber"}>
              {cfg?.api_keys_enabled ? "Enabled" : "Disabled in Settings"}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="table-wrap">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Owner</th>
                    <th>Prefix</th>
                    <th>Scope</th>
                    <th>Expires</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td className="font-semibold text-[var(--fg)]">
                        {k.name}
                      </td>
                      <td>{k.user_name}</td>
                      <td className="mono">{k.prefix}…</td>
                      <td>
                        <Badge
                          tone={
                            k.scope === "admin"
                              ? "blue"
                              : k.scope === "write"
                                ? "green"
                                : "neutral"
                          }
                        >
                          {k.scope}
                        </Badge>
                      </td>
                      <td>
                        {k.expires_at
                          ? new Date(k.expires_at).toLocaleDateString()
                          : "Never"}
                      </td>
                      <td>
                        {k.last_used_at
                          ? new Date(k.last_used_at).toLocaleString()
                          : "Never"}
                      </td>
                      <td>
                        <Badge tone={k.enabled ? "green" : "amber"}>
                          {k.enabled ? "Active" : "Paused"}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleKey(k)}
                          >
                            {k.enabled ? "Pause" : "Enable"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Revoke"
                            onClick={() => revokeKey(k)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!keys.length && (
              <div className="p-12 text-center text-[11px] text-[var(--muted)]">
                No API keys created.
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {editor && (
        <Dialog
          label="Administrator"
          onClose={() => {
            if (!busy) setEditor(null);
          }}
        >
          <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <div className="text-[14px] font-semibold">
                {editor.id ? "Edit administrator" : "Add administrator"}
              </div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                Use strong passwords and enable 2FA after first login.
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setEditor(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <form onSubmit={save}>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Username">
                <input
                  className="input"
                  value={editor.username}
                  onChange={(e) =>
                    setEditor({ ...editor, username: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={editor.email}
                  onChange={(e) =>
                    setEditor({ ...editor, email: e.target.value })
                  }
                />
              </Field>
              <Field
                label={editor.id ? "New password (optional)" : "Password"}
                className="sm:col-span-2"
              >
                <input
                  className="input"
                  type="password"
                  minLength={12}
                  value={editor.password}
                  onChange={(e) =>
                    setEditor({ ...editor, password: e.target.value })
                  }
                  required={!editor.id}
                />
              </Field>
              <Toggle
                label="Active account"
                checked={editor.is_active}
                onChange={(v) => setEditor({ ...editor, is_active: v })}
              />
              <Toggle
                label="Staff access"
                checked={editor.is_staff}
                onChange={(v) => setEditor({ ...editor, is_staff: v })}
              />
              <Toggle
                label="Superuser"
                checked={editor.is_superuser}
                onChange={(v) => setEditor({ ...editor, is_superuser: v })}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button variant="outline" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save administrator"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {keyEditor && (
        <Dialog
          label="Create API key"
          onClose={() => {
            if (!busy) setKeyEditor(null);
          }}
        >
          <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <div className="text-[14px] font-semibold">Create API key</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                The full key is displayed only once after creation.
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setKeyEditor(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <form onSubmit={createKey}>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Key name">
                <input
                  className="input"
                  value={keyEditor.name}
                  onChange={(e) =>
                    setKeyEditor({ ...keyEditor, name: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Owner">
                <select
                  className="input"
                  value={keyEditor.user}
                  onChange={(e) =>
                    setKeyEditor({ ...keyEditor, user: e.target.value })
                  }
                >
                  {users
                    .filter((u) => u.is_staff && u.is_active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Scope">
                <select
                  className="input"
                  value={keyEditor.scope}
                  onChange={(e) =>
                    setKeyEditor({ ...keyEditor, scope: e.target.value as any })
                  }
                >
                  <option value="read">Read only</option>
                  <option value="write">Read + write</option>
                  <option value="admin">Administrator</option>
                </select>
              </Field>
              <Field label="Expires in days">
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="3650"
                  value={keyEditor.days}
                  onChange={(e) =>
                    setKeyEditor({ ...keyEditor, days: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button variant="outline" onClick={() => setKeyEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                <KeyRound className="h-3.5 w-3.5" />
                {busy ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
function Mini({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-[9px] text-[var(--muted)]">{label}</div>
          <div className="mt-1.5 text-[22px] font-semibold">{value}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-2)]">
          <FaIcon icon={icon} />
        </div>
      </CardContent>
    </Card>
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
  return (
    <label className={`label ${className}`}>
      {label}
      {children}
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[11px]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
