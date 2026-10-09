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
      ["POST", "/api/clients/:id/toggle/", "Enable or disable client"],
      ["POST", "/api/clients/:id/reset-usage/", "Reset persisted quota usage"],
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
