import { useEffect, useRef, useState } from "react";
import { Rocket, X, Search, Check } from "lucide-react";
import { Dialog } from "@/components/common/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
type Result = {
  domain: string;
  valid: boolean;
  latency_ms: number;
  tls_version: string;
  alpn: string;
  error?: string;
};
export function SNIScanner({
  node,
  value,
  onChange,
}: {
  node: string;
  value: string;
  onChange: (domain: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [domain, setDomain] = useState(value),
    [results, setResults] = useState<Result[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function close() {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setOpen(false);
  }
  async function scan(suggest: boolean) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setResults([]);
    setBusy(true);
    setError("");
    try {
      const out = await api<{ results: Result[] }>(`/nodes/${node}/sni-scan`, {
        signal: controller.signal,
        method: "POST",
        body: JSON.stringify({
          domains: suggest ? [] : domain.split(/[\s,]+/).filter(Boolean),
        }),
      });
      if (controller.signal.aborted) return;
      setResults(
        out.results.sort(
          (a, b) =>
            Number(b.valid) - Number(a.valid) || a.latency_ms - b.latency_ms,
        ),
      );
    } catch (e: any) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <div className="sni-field">
        <Input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="sni-rocket"
          disabled={!node}
          aria-label={t("Scan SNI")}
          title={t("Scan SNI")}
          onClick={() => {
            setDomain(value);
            setResults([]);
            setError("");
            setOpen(true);
          }}
        >
          <Rocket size={16} />
        </button>
      </div>
      {open && (
        <Dialog label={t("SNI scanner")} size="sm" onClose={close}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold">{t("SNI scanner")}</h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Close")}
              onClick={close}
            >
              <X size={16} />
            </Button>
          </div>
          <label className="label">
            {t("Domain")}
            <Input
              className="input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="www.example.com"
            />
          </label>
          <div className="flex gap-2 my-4">
            <Button
              disabled={busy || !domain.trim()}
              onClick={() => scan(false)}
            >
              <Search size={14} />
              {t("Scan")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => scan(true)}
            >
              <Rocket size={14} />
              {t("Find SNI")}
            </Button>
          </div>
          {busy && (
            <p className="text-xs text-[var(--muted)]">
              {t("Scanning from this node…")}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="sni-results space-y-2">
            {results.map((r) => (
              <div key={r.domain} className="sni-result">
                <div>
                  <div className="text-xs font-medium">{r.domain}</div>
                  <div className="text-[10px] text-[var(--muted)] mt-1">
                    {r.valid
                      ? `${r.latency_ms} ms · ${r.tls_version} · ${r.alpn}`
                      : r.error}
                  </div>
                </div>
                {r.valid && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onChange(r.domain);
                      close();
                    }}
                  >
                    <Check size={14} />
                    {t("Use")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
