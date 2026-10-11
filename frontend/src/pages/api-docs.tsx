import { APIKeys } from "@/components/api-keys";
import { useLocale, t } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { FaIcon } from "@/components/ui/fa-icon";

const groups = [
  {
    name: t("Panel and nodes"),
    rows: [
      [t("GET"), "/api/overview", t("Dashboard totals")],
      [t("GET"), "/api/nodes/", t("List nodes")],
      [t("POST"), "/api/nodes/:id/probe/", t("Probe Agent and Xray")],
      [
        t("POST"),
        "/api/nodes/:id/deploy/",
        t("Validate and apply generated config"),
      ],
      [
        t("GET"),
        "/api/nodes/:id/config-preview/",
        t("Preview generated Xray JSON"),
      ],
      [
        t("GET"),
        "/api/nodes/:id/ports/",
        t("Check listeners and current socket owners"),
      ],
      [
        t("POST"),
        "/api/nodes/:id/check-listener/",
        t("Check a proposed inbound port"),
      ],
      [
        t("POST"),
        "/api/nodes/:id/config-validate/",
        t("Validate configuration and listener availability"),
      ],
      [t("POST"), "/api/nodes/:id/xray-restart/", t("Restart Xray service")],
    ],
  },
  {
    name: t("Inbounds & clients"),
    rows: [
      [t("GET / POST"), "/api/inbounds/", t("List or create inbounds")],
      [
        t("PATCH / DELETE"),
        "/api/inbounds/:id/",
        t("Update or remove inbound"),
      ],
      [t("POST"), "/api/inbounds/:id/clone/", t("Clone an inbound to a node")],
      [t("GET / POST"), "/api/clients/", t("List or create clients")],
      [
        t("PATCH"),
        "/api/clients/:id/",
        t("Update policy, including traffic_multiplier"),
      ],
      [
        t("POST"),
        "/api/clients/batch",
        t("Create 1–100 clients in one deployment"),
      ],
      [
        t("POST"),
        "/api/clients/bulk",
        t("Apply an action to 1–200 clients atomically"),
      ],
      [t("POST"), "/api/clients/:id/toggle/", t("Enable or disable client")],
      [
        t("POST"),
        "/api/clients/:id/reset-usage/",
        t("Reset persisted quota usage"),
      ],
    ],
  },
  {
    name: t("Imports and Telegram (administrators)"),
    rows: [
      [
        t("POST"),
        "/api/imports/preview",
        t("Multipart file + node; private preview valid for 30 minutes"),
      ],
      [
        t("POST"),
        "/api/imports/commit",
        t(
          "token, selected source IDs and optional port_overrides; save disabled",
        ),
      ],
      [t("GET"), "/api/telegram/status", t("Bot identity and polling status")],
      [t("POST"), "/api/telegram/test", t("Send a test to configured owners")],
      [
        t("POST"),
        "/api/telegram/setup",
        t("Register commands for private owner chats"),
      ],
    ],
  },
  {
    name: t("Subscriptions"),
    rows: [
      [
        t("GET"),
        "/sub/:token",
        t("Browser portal or auto-detected client feed"),
      ],
      [t("GET"), "/sub/:token?format=base64", t("Base64 Xray feed")],
      [t("GET"), "/sub/:token?format=clash", t("Clash/Mihomo YAML")],
      [t("GET"), "/sub/:token?format=raw", t("Direct connection URI")],
      [t("GET"), "/sub/:token?format=json", t("Profile metadata JSON")],
    ],
  },
];
export function ApiDocsPage() {
  useLocale();
  return (
    <div className="space-y-6">
      <APIKeys />
      <PageHeader
        title={t("API reference")}
        description={t(
          "Session-authenticated REST endpoints used by the VeloRay web panel and automation.",
        )}
      />
      <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 px-4 py-3 text-[11px] leading-5 text-[var(--muted-strong)]">
        <FaIcon icon="shield-halved" className="mr-1.5 text-blue-500" />
        {t(
          "Browser API uses secure sessions and CSRF protection. Public subscription routes are token-scoped and do not expose panel administration.",
        )}
      </div>
      {groups.map((g) => (
        <Card key={g.name}>
          <CardHeader>
            <CardTitle>{g.name}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="table-wrap">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>{t("Method")}</th>
                    <th>{t("Path")}</th>
                    <th>{t("Description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <Badge
                          tone={
                            String(r[0]).includes(t("POST"))
                              ? "blue"
                              : "neutral"
                          }
                        >
                          {r[0]}
                        </Badge>
                      </td>
                      <td className="mono text-[10px] text-[var(--fg)]">
                        {r[1]}
                      </td>
                      <td>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
