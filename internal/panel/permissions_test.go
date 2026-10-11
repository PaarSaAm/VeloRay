package panel

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRolePermissionPresets(t *testing.T) {
	reseller := Data{"id": 2, "role": "reseller", "allowed_inbounds": []any{json.Number("4")}}
	if !ownClients(reseller) || !permitted(reseller, "clients.write") || permitted(reseller, "nodes.write") || !inboundAllowed(reseller, 4) || inboundAllowed(reseller, 5) {
		t.Fatal("reseller preset escaped its scope")
	}
	viewer := Data{"role": "viewer"}
	if !permitted(viewer, "clients.read") || permitted(viewer, "clients.write") {
		t.Fatal("viewer can mutate")
	}
	custom := Data{"role": "custom", "permissions": []any{"traffic.read"}}
	if !permitted(custom, "traffic.read") || permitted(custom, "clients.read") {
		t.Fatal("custom permissions are not exact")
	}
}
func TestIntegrationResellerIsolationAndBudgets(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	_, inbound, foreign := fixture(t, s, ctx, m)
	admin := defaults("users")
	admin["username"] = "owner"
	admin["is_superuser"] = true
	if e := save(ctx, s.Store.Pool, "users", admin); e != nil {
		t.Fatal(e)
	}
	foreign["owner_id"] = num(admin, "id")
	if e := save(ctx, s.Store.Pool, "clients", foreign); e != nil {
		t.Fatal(e)
	}
	reseller := defaults("users")
	reseller["username"] = "reseller"
	reseller["role"] = "reseller"
	reseller["max_clients"] = 1
	reseller["traffic_budget_bytes"] = 100
	reseller["allowed_inbounds"] = []any{num(inbound, "id")}
	if e := save(ctx, s.Store.Pool, "users", reseller); e != nil {
		t.Fatal(e)
	}
	actor := Actor{User: reseller, Scope: "admin"}
	call := func(method, path, body string) (any, error) {
		r := httptest.NewRequest(method, "/api/"+path, strings.NewReader(body)).WithContext(ctx)
		out, _, e := s.api(httptest.NewRecorder(), r, path, actor)
		return out, e
	}
	for _, path := range []string{"admin/users/", "nodes/", "audit/"} {
		if e := s.authorize(ctx, actor, "GET", strings.TrimSuffix(path, "/")); e == nil {
			t.Fatalf("reseller gained access to %s", path)
		}
	}
	listed, e := call("GET", "clients", "")
	if e != nil || len(listed.([]Data)) != 0 {
		t.Fatal("foreign clients leaked", listed, e)
	}
	if _, e = call("GET", "clients/1", ""); e == nil {
		t.Fatal("foreign client can be read")
	}
	if _, e = call("POST", "clients/1/toggle", ""); e == nil {
		t.Fatal("foreign client can be changed")
	}
	if _, e = call("POST", "clients/bulk", `{"ids":[1],"action":"reset"}`); e == nil {
		t.Fatal("foreign client can be bulk-reset")
	}
	created, e := call("POST", "clients", `{"name":"owned","inbound":1,"traffic_limit_bytes":50,"traffic_multiplier":25}`)
	if e != nil {
		t.Fatal(e)
	}
	c := created.(Data)
	if num(c, "owner_id") != num(reseller, "id") {
		t.Fatal("wrong owner", c)
	}
	if _, e = call("POST", "clients", `{"name":"excess","inbound":1,"traffic_limit_bytes":25}`); e == nil {
		t.Fatal("client limit bypassed")
	}
	if _, e = call("PATCH", "clients/2", `{"traffic_limit_bytes":101}`); e == nil {
		t.Fatal("budget bypassed")
	}
	if _, e = call("POST", "clients", `{"name":"foreign-owner","inbound":1,"owner_id":1}`); e == nil {
		t.Fatal("owner reassignment bypassed")
	}
	events, err := s.AuditEvents(ctx, 1)
	if err != nil || len(events) != 1 {
		t.Fatal("server audit limit", events, err)
	}
	traffic, e := call("GET", "traffic/clients", "")
	if e != nil || len(traffic.([]Data)) != 1 || traffic.([]Data)[0]["credential"] != nil {
		t.Fatal("traffic endpoint leaked credentials", traffic, e)
	}
	overview, e := s.overviewForActor(ctx, actor)
	if e != nil || num(overview, "clients_total") != 1 {
		t.Fatal(overview, e)
	}
}
func TestIntegrationOnlineViewUsesFreshNativeTelemetry(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	node, _, client := fixture(t, s, ctx, m)
	node["_online_available"] = true
	node["_telemetry_at"] = stamp()
	node["_online_clients"] = Data{"1": true}
	if e := save(ctx, s.Store.Pool, "nodes", node); e != nil {
		t.Fatal(e)
	}
	view, e := s.view(ctx, s.Store.Pool, "clients", client)
	if e != nil || !flag(view, "online") {
		t.Fatal(view, e)
	}
	node["_telemetry_at"] = stamp(time.Now().Add(-time.Minute))
	if e := save(ctx, s.Store.Pool, "nodes", node); e != nil {
		t.Fatal(e)
	}
	view, e = s.view(ctx, s.Store.Pool, "clients", client)
	if e != nil || view["online"] != nil || str(view, "connection_status") != "unknown" {
		t.Fatal("stale client falsely reported online", view, e)
	}
}
