import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { FaIcon } from "@/components/ui/fa-icon";

const groups = [
  {
    name: "Panel and nodes",
    rows: [
      ["GET", "/api/overview", "Dashboard totals"],
      ["GET", "/api/nodes/", "List nodes"],
      ["POST", "/api/nodes/:id/probe/", "Probe Agent and Xray"],
      ["POST", "/api/nodes/:id/deploy/", "Validate and apply generated config"],
      ["GET", "/api/nodes/:id/config-preview/", "Preview generated Xray JSON"],
      [
        "GET",
        "/api/nodes/:id/ports/",
        "Check listeners and current socket owners",
      ],
      [
        "POST",
        "/api/nodes/:id/check-listener/",
        "Check a proposed inbound port",
      ],
      [
        "POST",
        "/api/nodes/:id/config-validate/",
        "Validate configuration and listener availability",
      ],
      ["POST", "/api/nodes/:id/xray-restart/", "Restart Xray service"],
    ],
  },
  {
    name: "Inbounds & clients",
    rows: [
      ["GET / POST", "/api/inbounds/", "List or create inbounds"],
      ["PATCH / DELETE", "/api/inbounds/:id/", "Update or remove inbound"],
      ["POST", "/api/inbounds/:id/clone/", "Clone an inbound to a node"],
      ["GET / POST", "/api/clients/", "List or create clients"],
      [
        "PATCH",
        "/api/clients/:id/",
        "Update policy, including traffic_multiplier (-1 to 3)",
      ],
      ["POST", "/api/clients/batch", "Create 1–100 clients in one deployment"],
      [
        "POST",
        "/api/clients/bulk",
        "Apply an action to 1–200 clients atomically",
      ],
      ["POST", "/api/clients/:id/toggle/", "Enable or disable client"],
      ["POST", "/api/clients/:id/reset-usage/", "Reset persisted quota usage"],
    ],
  },
  {
    name: "Imports and Telegram (administrators)",
    rows: [
      [
        "POST",
        "/api/imports/preview",
        "Multipart file + node; private preview valid for 30 minutes",
      ],
      [
        "POST",
        "/api/imports/commit",
        "token, selected source IDs and optional port_overrides; save disabled",
      ],
      ["GET", "/api/telegram/status", "Bot identity and polling status"],
      ["POST", "/api/telegram/test", "Send a test to configured owners"],
      [
        "POST",
        "/api/telegram/setup",
        "Register commands for private owner chats",
      ],
    ],
  },
  {
    name: "Subscriptions",
    rows: [
      ["GET", "/sub/:token", "Browser portal or auto-detected client feed"],
      ["GET", "/sub/:token?format=base64", "Base64 Xray feed"],
      ["GET", "/sub/:token?format=clash", "Clash/Mihomo YAML"],
      ["GET", "/sub/:token?format=raw", "Direct connection URI"],
      ["GET", "/sub/:token?format=json", "Profile metadata JSON"],
    ],
  },
];
export function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API reference"
        description="Session-authenticated REST endpoints used by the VeloRay web panel and automation."
      />
      <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 px-4 py-3 text-[11px] leading-5 text-[var(--muted-strong)]">
        <FaIcon icon="shield-halved" className="mr-1.5 text-blue-500" />
        Browser API uses secure sessions and CSRF protection. Public
        subscription routes are token-scoped and do not expose panel
        administration.
        <p className="mt-2">
          Client traffic_multiplier defaults to 1, accepts three decimal places
          and has a maximum of 3. Negative values are discounts: -0.5 bills half
          the actual traffic. Changes apply to subsequent traffic. Shared
          account policy applies to every connection; account_id identifies the
          shared quota, and raw_used_traffic_bytes reports actual usage.
        </p>
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
                    <th>Method</th>
                    <th>Path</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <Badge
                          tone={
                            String(r[0]).includes("POST") ? "blue" : "neutral"
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
