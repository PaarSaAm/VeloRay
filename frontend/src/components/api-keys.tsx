import { useEffect, useState, type FormEvent } from "react";
import { Copy, Plus, RotateCcw, Trash2, X, Check } from "lucide-react";
import { api, type AdminAPIKey } from "@/lib/api";
import { useSession } from "@/lib/session";
import { t } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/common/dialog";
import { Input, Select } from "@/components/ui/controls";
export function APIKeys() {
  const session = useSession(),
    [keys, setKeys] = useState<AdminAPIKey[]>([]),
    [token, setToken] = useState(""),
    [form, setForm] = useState(false),
    [name, setName] = useState(""),
    [scope, setScope] = useState("read"),
    [days, setDays] = useState("90"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  async function load() {
    if (!session?.is_superuser) return;
    try {
      setKeys(await api<AdminAPIKey[]>("/admin/api-keys/"));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
  }, [session?.is_superuser]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const key = await api<AdminAPIKey>("/admin/api-keys/", {
        method: "POST",
        body: JSON.stringify({
          name,
          scope,
          enabled: true,
          expires_at: new Date(
            Date.now() + Number(days) * 86400000,
          ).toISOString(),
        }),
      });
      setToken(key.token || "");
      setCopied(false);
      setForm(false);
      setName("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reset(k: AdminAPIKey) {
    if (!confirm(`${t("Reset key")} ${k.name}?`)) return;
    try {
      const result = await api<AdminAPIKey>(`/admin/api-keys/${k.id}/reset`, {
        method: "POST",
      });
      setToken(result.token || "");
      setCopied(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function remove(k: AdminAPIKey) {
    if (!confirm(`${t("Delete")} ${k.name}?`)) return;
    try {
      await api(`/admin/api-keys/${k.id}/`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  if (!session?.is_superuser) return null;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("API keys")}</CardTitle>
          <Button onClick={() => setForm(true)} size="sm">
            <Plus size={14} />
            {t("Create key")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <p role="alert" className="form-error m-4">
              {error}
            </p>
          )}
          <div className="table-wrap">
            <table className="data-table min-w-[560px]">
              <thead>
                <tr>
                  <th>{t("Name")}</th>
                  <th>{t("Prefix")}</th>
                  <th>{t("Scope")}</th>
                  <th>{t("Expires at")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="font-mono text-xs">{k.prefix}…</td>
                    <td>{k.scope}</td>
                    <td>
                      {k.expires_at
                        ? new Date(k.expires_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reset(k)}
                        >
                          <RotateCcw size={13} />
                          {t("Reset")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("Delete")}
                          onClick={() => remove(k)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!keys.length && <p className="empty-state">{t("No keys yet.")}</p>}
          </div>
        </CardContent>
      </Card>
      {form && (
        <Dialog label={t("Create key")} onClose={() => setForm(false)}>
          <div className="flex justify-between mb-5">
            <h3 className="font-semibold">{t("Create key")}</h3>
            <Button variant="ghost" size="icon" onClick={() => setForm(false)}>
              <X size={16} />
            </Button>
          </div>
          <form className="space-y-4" onSubmit={create}>
            <label className="label">
              {t("Name")}
              <Input
                className="input"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="label">
              {t("Scope")}
              <Select
                className="input"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
                <option value="admin">Admin</option>
              </Select>
            </label>
            <label className="label">
              {t("Valid for (days)")}
              <Input
                className="input"
                type="number"
                min="1"
                max="36500"
                required
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {t("Create key")}
            </Button>
          </form>
        </Dialog>
      )}
      {token && (
        <Dialog label={t("Your API key")} onClose={() => setToken("")}>
          <div className="flex justify-between mb-5">
            <h3 className="font-semibold">{t("Your API key")}</h3>
            <Button variant="ghost" size="icon" onClick={() => setToken("")}>
              <X size={16} />
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)] mb-4">
            {t("Copy now. This key is shown only once.")}
          </p>
          <div
            className="rounded-lg border border-[var(--border)] p-4 font-mono text-xs break-all"
            dir="ltr"
          >
            {token}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" onClick={() => setToken("")}>
              {t("Done")}
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token);
                  setCopied(true);
                } catch {
                  setError(t("Copy failed."));
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {t("Copy")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
