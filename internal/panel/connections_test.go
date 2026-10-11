package panel

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDeviceHeaders(t *testing.T) {
	r := httptest.NewRequest("GET", "/sub/token", nil)
	if subscriptionDevice(r) != nil {
		t.Fatal("fabricated device without HWID")
	}
	r.Header.Set("X-HWID", "device-123")
	r.Header.Set("X-Device-Model", strings.Repeat("a", 257))
	r.Header.Set("X-Device-OS", "iOS\ninvalid")
	d := subscriptionDevice(r)
	if str(d, "hwid") != "device-123" || str(d, "device_model") != "" || str(d, "device_os") != "" {
		t.Fatal(d)
	}
	r.Header.Set("X-HWID", strings.Repeat("a", 257))
	if subscriptionDevice(r) != nil {
		t.Fatal("oversized identifier accepted")
	}
}
func TestConnectedIPsFreshnessAndDeduplication(t *testing.T) {
	now := time.Now().UTC()
	c := Data{"id": int64(1), "name": "alice", "inbound": int64(1), "enabled": true}
	i := Data{"id": int64(1), "node": int64(1), "name": "main", "enabled": true}
	n := Data{"id": int64(1), "name": "Local", "enabled": true, "_telemetry_at": stamp(now), "_online_ip_cores": Data{"xray": true}, "_online_ips": Data{"veloray:1:alice": Data{"203.0.113.1": now.Unix(), "::ffff:203.0.113.1": now.Unix(), "invalid": now.Unix()}}}
	rows, complete := connectedIPs([]Data{c}, map[int64]Data{1: i}, map[int64]Data{1: n}, now)
	if !complete || len(rows) != 1 || str(rows[0], "ip") != "203.0.113.1" {
		t.Fatal(rows, complete)
	}
	n["_telemetry_at"] = stamp(now.Add(-time.Minute))
	rows, complete = connectedIPs([]Data{c}, map[int64]Data{1: i}, map[int64]Data{1: n}, now)
	if complete || len(rows) > 0 {
		t.Fatal("stale online IP displayed", rows)
	}
	n["_telemetry_at"] = stamp(now)
	n["_online_ip_cores"] = Data{"xray": false, "singbox": true}
	rows, complete = connectedIPs([]Data{c}, map[int64]Data{1: i}, map[int64]Data{1: n}, now)
	if complete || len(rows) > 0 {
		t.Fatal("wrong core availability", rows)
	}
}
func TestIntegrationRegisteredDevicesAndClientScope(t *testing.T) {
	s, ctx := integration(t)
	_, _, c := fixture(t, s, ctx, &nodeMock{running: true})
	url := "/sub/" + str(c, "subscription_token")
	fetch := func(method, format, hwid, model string) int {
		r := httptest.NewRequest(method, url+"?format="+format, nil)
		r.Header.Set("X-HWID", hwid)
		r.Header.Set("X-Device-Model", model)
		r.Header.Set("X-Device-OS", "iOS")
		r.Header.Set("X-Ver-OS", "18.3")
		r.Header.Set("User-Agent", "TestApp/1.0")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w.Code
	}
	for _, format := range []string{"base64", "raw", "json", "clash", "singbox"} {
		if code := fetch("GET", format, "device-123", "iPhone"); code != 200 {
			t.Fatal(format, code)
		}
	}
	if fetch("GET", "base64", "device-123", "") != 200 {
		t.Fatal("repeat download")
	}
	for _, v := range []struct{ method, format, hwid string }{{"HEAD", "raw", "head-device"}, {"GET", "portal", "portal-device"}, {"GET", "html", "html-device"}, {"GET", "bad", "failed-device"}, {"GET", "raw", ""}} {
		fetch(v.method, v.format, v.hwid, "")
	}
	out, err := s.clientConnections(ctx, num(c, "id"), "devices")
	if err != nil || num(out, "count") != 1 {
		t.Fatal(out, err)
	}
	device := out["items"].([]Data)[0]
	if str(device, "device_model") != "iPhone" || str(device, "os_version") != "18.3" || str(device, "first_seen_at") == "" {
		t.Fatal(device)
	}
	var wg sync.WaitGroup
	failures := make(chan int, 24)
	for j := 0; j < 24; j++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if code := fetch("GET", "base64", "concurrent-device", "Pixel"); code != 200 {
				failures <- code
			}
		}()
	}
	wg.Wait()
	close(failures)
	for code := range failures {
		t.Fatal(code)
	}
	out, err = s.clientConnections(ctx, num(c, "id"), "devices")
	if err != nil || num(out, "count") != 2 {
		t.Fatal("concurrent registration duplicated", out, err)
	}
	actor := Actor{User: Data{"id": int64(99), "role": "reseller", "own_clients_only": true}, Scope: "read"}
	for _, endpoint := range []string{"ips", "devices"} {
		path := fmt.Sprintf("clients/%d/%s", num(c, "id"), endpoint)
		r := httptest.NewRequest(http.MethodGet, "/api/"+path, nil)
		_, _, err = s.api(httptest.NewRecorder(), r, path, actor)
		if err == nil {
			t.Fatal("other client details leaked", endpoint)
		}
	}
	if err = s.Store.Migrate(ctx); err != nil {
		t.Fatal("repeat migration", err)
	}
	if err = remove(ctx, s.Store.Pool, "clients", num(c, "id")); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.Store.Pool.QueryRow(ctx, "SELECT count(*) FROM vr_client_devices").Scan(&count); err != nil || count != 0 {
		t.Fatal("device rows survived deletion", count, err)
	}
}
func TestIntegrationSharedAccountDevicesAndIPs(t *testing.T) {
	s, ctx := integration(t)
	n, i, c := fixture(t, s, ctx, &nodeMock{running: true})
	account := Data{"_node": num(n, "id")}
	var accountID int64
	if err := s.Store.Pool.QueryRow(ctx, `INSERT INTO vr_accounts(data) VALUES($1) RETURNING id`, account).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	c["_account"] = accountID
	if err := save(ctx, s.Store.Pool, "clients", c); err != nil {
		t.Fatal(err)
	}
	sibling := clone(c)
	delete(sibling, "id")
	sibling["name"] = "alice-second"
	sibling["subscription_token"] = randomToken(32)
	sibling["credential"] = uuid()
	if err := save(ctx, s.Store.Pool, "clients", sibling); err != nil {
		t.Fatal(err)
	}
	for _, member := range []Data{c, sibling} {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-HWID", "shared-device")
		if err := s.recordSubscriptionDevice(r, member); err != nil {
			t.Fatal(err)
		}
		out, err := s.clientConnections(ctx, num(member, "id"), "devices")
		if err != nil || num(out, "count") != 1 {
			t.Fatal(out, err)
		}
	}
	n["_telemetry_at"] = stamp()
	n["_online_ip_cores"] = Data{"xray": true}
	n["_online_ips"] = Data{fmt.Sprintf("veloray:%d:alice", num(c, "id")): Data{"203.0.113.1": time.Now().Unix()}, fmt.Sprintf("veloray:%d:alice-second", num(sibling, "id")): Data{"203.0.113.1": time.Now().Unix(), "2001:db8::1": time.Now().Unix()}}
	if err := save(ctx, s.Store.Pool, "nodes", n); err != nil {
		t.Fatal(err)
	}
	out, err := s.clientConnections(ctx, num(c, "id"), "ips")
	if err != nil || num(out, "count") != 2 || !flag(out, "available") {
		t.Fatal(out, err, i)
	}
	for _, entry := range out["items"].([]Data) {
		if str(entry, "ip") == "203.0.113.1" && len(array(entry, "connections")) != 2 {
			t.Fatal(entry)
		}
	}
	if err := remove(ctx, s.Store.Pool, "clients", num(c, "id")); err != nil {
		t.Fatal(err)
	}
	out, err = s.clientConnections(ctx, num(sibling, "id"), "devices")
	if err != nil || num(out, "count") != 1 {
		t.Fatal("shared registration lost", out, err)
	}
}
