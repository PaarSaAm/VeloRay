import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/layout/shell";
import type { RouteKey } from "@/components/layout/sidebar";
const Dashboard = lazy(() =>
  import("@/pages/dashboard").then((m) => ({ default: m.Dashboard })),
);
const NodesPage = lazy(() =>
  import("@/pages/nodes").then((m) => ({ default: m.NodesPage })),
);
const InboundsPage = lazy(() =>
  import("@/pages/inbounds").then((m) => ({ default: m.InboundsPage })),
);
const ClientsPage = lazy(() =>
  import("@/pages/clients").then((m) => ({ default: m.ClientsPage })),
);
const SubscriptionsPage = lazy(() =>
  import("@/pages/subscriptions").then((m) => ({
    default: m.SubscriptionsPage,
  })),
);
const TrafficPage = lazy(() =>
  import("@/pages/traffic").then((m) => ({ default: m.TrafficPage })),
);
const SecurityPage = lazy(() =>
  import("@/pages/security").then((m) => ({ default: m.SecurityPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings").then((m) => ({ default: m.SettingsPage })),
);
const AuditPage = lazy(() =>
  import("@/pages/audit").then((m) => ({ default: m.AuditPage })),
);
const XrayPage = lazy(() =>
  import("@/pages/xray").then((m) => ({ default: m.XrayPage })),
);
const ApiDocsPage = lazy(() =>
  import("@/pages/api-docs").then((m) => ({ default: m.ApiDocsPage })),
);
const AdminPage = lazy(() =>
  import("@/pages/admin").then((m) => ({ default: m.AdminPage })),
);
import { LoginPage } from "@/pages/login";
import {
  api,
  currentSession,
  logout,
  type AppSettings,
  type Session,
} from "@/lib/api";
import { VeloRayMark } from "@/components/brand/veloray-mark";

const meta: Record<RouteKey, [string, string]> = {
  dashboard: ["Dashboard", "Traffic and server status"],
  clients: ["Clients", "Credentials, quotas, expiry and subscription access"],
  inbounds: [
    "Inbounds",
    "Validated Xray listeners, transports and REALITY/TLS settings",
  ],
  nodes: ["Nodes", "Local server and remote VeloRay agents"],
  subscriptions: ["Subscriptions", "Browser portals and client feed endpoints"],
  traffic: ["Traffic", "Persisted Xray per-client accounting"],
  xray: ["Xray Core", "Generated config, advanced patches and runtime actions"],
  audit: ["Audit log", "Who changed what, and when"],
  security: ["Security", "Administrator 2FA and account protection"],
  api: ["API", "REST endpoints and automation reference"],
  settings: [
    "Settings",
    "Runtime information, product defaults and host management",
  ],
  admin: ["Administration", "Panel operators, roles and account security"],
};
const routes: Record<string, RouteKey> = {
  "/": "dashboard",
  "/dashboard": "dashboard",
  "/clients": "clients",
  "/inbounds": "inbounds",
  "/nodes": "nodes",
  "/subscriptions": "subscriptions",
  "/traffic": "traffic",
  "/xray": "xray",
  "/audit": "audit",
  "/security": "security",
  "/api-docs": "api",
  "/settings": "settings",
  "/admin": "admin",
};
const paths: Record<RouteKey, string> = {
  dashboard: "/dashboard",
  clients: "/clients",
  inbounds: "/inbounds",
  nodes: "/nodes",
  subscriptions: "/subscriptions",
  traffic: "/traffic",
  xray: "/xray",
  audit: "/audit",
  security: "/security",
  api: "/api-docs",
  settings: "/settings",
  admin: "/admin",
};

export default function App() {
  const [user, setUser] = useState<Session | null | undefined>(undefined);
  const initial = routes[window.location.pathname] || "dashboard";
  const [route, setRouteState] = useState<RouteKey>(initial);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      currentSession()
        .then((u) => {
          if (active) setUser(u);
        })
        .catch(() => {
          if (active) setUser(null);
        });
    const expired = () => setUser(null);
    void refresh();
    window.addEventListener("veloray:session-expired", expired);
    window.addEventListener("veloray:session-update", refresh);
    return () => {
      active = false;
      window.removeEventListener("veloray:session-expired", expired);
      window.removeEventListener("veloray:session-update", refresh);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    api<AppSettings>("/settings")
      .then((s) => {
        document.documentElement.dataset.accent = s.accent || "emerald";
        document.title = `${s.site_name || "VeloRay"}`;
      })
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    if (user?.two_factor_setup_required) {
      setRouteState("security");
      if (window.location.pathname !== "/security")
        history.replaceState({}, "", "/security");
    }
  }, [user?.two_factor_setup_required]);
  useEffect(() => {
    const f = () =>
      setRouteState(routes[window.location.pathname] || "dashboard");
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  const setRoute = (r: RouteKey) => {
    setRouteState(r);
    const p = paths[r];
    if (window.location.pathname !== p) history.pushState({}, "", p);
  };
  const page = useMemo(() => {
    switch (route) {
      case "dashboard":
        return <Dashboard />;
      case "nodes":
        return <NodesPage />;
      case "inbounds":
        return <InboundsPage />;
      case "clients":
        return <ClientsPage />;
      case "subscriptions":
        return <SubscriptionsPage />;
      case "traffic":
        return <TrafficPage />;
      case "xray":
        return <XrayPage />;
      case "audit":
        return <AuditPage />;
      case "security":
        return <SecurityPage />;
      case "api":
        return <ApiDocsPage />;
      case "admin":
        return user?.is_superuser ? <AdminPage /> : <SettingsPage />;
      default:
        return <SettingsPage />;
    }
  }, [route, user?.is_superuser]);
  if (user === undefined)
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--bg)]">
        <div className="flex items-center gap-3 text-[12px] text-[var(--muted)]">
          <VeloRayMark className="h-8 w-8 animate-pulse" />
          Loading…
        </div>
      </div>
    );
  if (!user)
    return <LoginPage onSuccess={() => currentSession().then(setUser)} />;
  const [title, subtitle] = meta[route];
  return (
    <Shell
      route={route}
      setRoute={setRoute}
      title={title}
      subtitle={subtitle}
      user={user}
      onLogout={async () => {
        try {
          await logout();
        } finally {
          setUser(null);
        }
      }}
    >
      <Suspense
        fallback={
          <div role="status" className="py-12 text-center text-[var(--muted)]">
            Loading…
          </div>
        }
      >
        {page}
      </Suspense>
    </Shell>
  );
}
