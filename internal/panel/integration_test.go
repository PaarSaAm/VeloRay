package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type nodeMock struct {
	value              int64
	running, failApply bool
	applies, rollbacks int
	config             Data
}

func (m *nodeMock) handler(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/health":
		writeJSON(w, 200, Data{"status": "ok", "xray": Data{"running": m.running, "version": "test"}})
	case "/xray/status":
		writeJSON(w, 200, Data{"running": m.running})
	case "/xray/stats":
		writeJSON(w, 200, Data{"accounting": "durable-v1", "ledger_id": "stable-ledger", "stat": []any{Data{"name": "user>>>veloray:1:alice>>>traffic>>>uplink", "value": m.value}}})
	case "/xray/validate":
		writeJSON(w, 200, Data{"status": "valid"})
	case "/xray/apply":
		m.applies++
		if m.failApply {
			writeJSON(w, 503, Data{"detail": "simulated failure"})
			return
		}
		var in Data
		_ = json.NewDecoder(r.Body).Decode(&in)
		m.config = obj(in, "config")
		writeJSON(w, 200, Data{"status": "applied"})
	case "/xray/rollback":
		m.rollbacks++
		writeJSON(w, 200, Data{"status": "rolled_back"})
	case "/xray/restart":
		writeJSON(w, 200, Data{"status": "restarted"})
	default:
		http.NotFound(w, r)
	}
}
func integration(t *testing.T) (*Server, context.Context) {
	t.Helper()
	dsn := os.Getenv("VELORAY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set VELORAY_TEST_DATABASE_URL to an isolated PostgreSQL database")
	}
	ctx := context.Background()
	store, e := OpenStore(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(store.Pool.Close)
	if e = store.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	_, e = store.Pool.Exec(ctx, `TRUNCATE vr_nodes,vr_inbounds,vr_clients,vr_users,vr_api_keys,vr_audit,vr_sessions,vr_stats_cursors,vr_traffic_windows,vr_jobs,vr_operations,vr_rate_limits,vr_telegram_updates RESTART IDENTITY CASCADE`)
	if e != nil {
		t.Fatal(e)
	}
	if e = saveSettings(ctx, store.Pool, defaultSettings()); e != nil {
		t.Fatal(e)
	}
	s := &Server{Config: Config{PublicURL: "http://127.0.0.1:8610", SecretKey: strings.Repeat("s", 32), FieldKey: strings.Repeat("f", 32), SessionAge: time.Hour, PanelPort: 8443, TrustedOrigins: map[string]bool{"http://127.0.0.1:8610": true}}, Store: store, Logger: slog.Default()}
	return s, ctx
}
func fixture(t *testing.T, s *Server, ctx context.Context, m *nodeMock) (Data, Data, Data) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(m.handler))
	t.Cleanup(server.Close)
	token, e := seal(s.Config.FieldKey, strings.Repeat("a", 32))
	if e != nil {
		t.Fatal(e)
	}
	n := defaults("nodes")
	n["name"] = fmt.Sprintf("node-%d", time.Now().UnixNano())
	n["public_host"] = "vpn.example"
	n["agent_url"] = server.URL
	n["_agent_token"] = token
	if e = save(ctx, s.Store.Pool, "nodes", n); e != nil {
		t.Fatal(e)
	}
	i := defaults("inbounds")
	i["node"] = num(n, "id")
	i["name"] = "main"
	i["port"] = 443
	if e = save(ctx, s.Store.Pool, "inbounds", i); e != nil {
		t.Fatal(e)
	}
	c := defaults("clients")
	c["inbound"] = num(i, "id")
	c["name"] = "alice"
	c["credential"] = uuid()
	c["subscription_token"] = randomToken(32)
	if e = save(ctx, s.Store.Pool, "clients", c); e != nil {
		t.Fatal(e)
	}
	return n, i, c
}
func TestIntegrationAccountingResetFailureAndHistory(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true, value: 100}
	n, _, c := fixture(t, s, ctx, m)
	collect := func() {
		tx, e := s.Store.Pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		fresh, _ := get(ctx, tx, "nodes", num(n, "id"))
		if e = s.collect(ctx, tx, fresh); e != nil {
			t.Fatal(e)
		}
		if e = tx.Commit(ctx); e != nil {
			t.Fatal(e)
		}
	}
	collect()
	collect()
	fresh, _ := get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if num(fresh, "used_traffic_bytes") != 100 {
		t.Fatal("double counted", fresh)
	}
	m.failApply = true
	_, e := s.change(ctx, []int64{num(n, "id")}, Actor{}, "deploy", "node", func(pgx.Tx) (any, error) { return nil, nil })
	if e == nil {
		t.Fatal("expected deploy failure")
	}
	collect()
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if num(fresh, "used_traffic_bytes") != 100 {
		t.Fatal("failed deploy doubled usage", fresh)
	}
	m.failApply = false
	m.value = 125
	_, _, e = s.action(httptest.NewRecorder(), httptest.NewRequest("POST", "/reset", nil), "clients", num(c, "id"), "reset-usage", Actor{})
	if e != nil {
		t.Fatal(e)
	}
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if num(fresh, "used_traffic_bytes") != 0 || num(fresh, "lifetime_traffic_bytes") != 125 {
		t.Fatal("reset harvested old usage after zeroing", fresh)
	}
	collect()
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if num(fresh, "used_traffic_bytes") != 0 {
		t.Fatal("reset cursor not advanced")
	}
	if e = remove(ctx, s.Store.Pool, "clients", num(c, "id")); e != nil {
		t.Fatal(e)
	}
	var history int64
	if e = s.Store.Pool.QueryRow(ctx, `SELECT COALESCE(sum(bytes),0) FROM vr_traffic_windows`).Scan(&history); e != nil || history != 125 {
		t.Fatal("history depends on current quota sum", history, e)
	}
}
func TestIntegrationPolicyRetriesAndRenewal(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true, value: 100, failApply: true}
	n, _, c := fixture(t, s, ctx, m)
	c["traffic_limit_bytes"] = 50
	if e := save(ctx, s.Store.Pool, "clients", c); e != nil {
		t.Fatal(e)
	}
	if e := s.reconcileNode(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	fresh, _ := get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if flag(fresh, "enabled") {
		t.Fatal("quota not enforced")
	}
	if e := s.runJob(ctx, num(n, "id")); e == nil {
		t.Fatal("expected failed apply")
	}
	m.failApply = false
	_, _ = s.Store.Pool.Exec(ctx, `UPDATE vr_jobs SET next_at=now()`)
	if e := s.runJob(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	if m.applies != 2 {
		t.Fatal("disabled client never retried", m.applies)
	}
	fresh["renewal_interval_days"] = 1
	fresh["next_renewal_at"] = stamp(time.Now().Add(-time.Hour))
	if e := save(ctx, s.Store.Pool, "clients", fresh); e != nil {
		t.Fatal(e)
	}
	if e := s.reconcileNode(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if num(fresh, "used_traffic_bytes") != 0 || !flag(fresh, "enabled") {
		t.Fatal("renewal failed", fresh)
	}
}
func TestIntegrationTwoNodeFailureCompensates(t *testing.T) {
	s, ctx := integration(t)
	first := &nodeMock{running: true}
	second := &nodeMock{running: true, failApply: true}
	n1, _, _ := fixture(t, s, ctx, first)
	n2, _, _ := fixture(t, s, ctx, second)
	_, e := s.change(ctx, []int64{num(n1, "id"), num(n2, "id")}, Actor{}, "move", "test", func(tx pgx.Tx) (any, error) {
		n, _ := get(ctx, tx, "nodes", num(n1, "id"))
		n["name"] = "changed"
		return nil, save(ctx, tx, "nodes", n)
	})
	if e == nil {
		t.Fatal("expected failure")
	}
	n, _ := get(ctx, s.Store.Pool, "nodes", num(n1, "id"))
	if str(n, "name") == "changed" || first.rollbacks != 1 {
		t.Fatal("database/runtime not compensated", n, first.rollbacks)
	}
}
func TestIntegrationMandatory2FAAppliesToAdminAPI(t *testing.T) {
	s, ctx := integration(t)
	u := defaults("users")
	u["username"] = "admin"
	u["is_superuser"] = true
	u["_password"], _ = hashPassword("Very-long-s3cret")
	if e := save(ctx, s.Store.Pool, "users", u); e != nil {
		t.Fatal(e)
	}
	cfg := defaultSettings()
	cfg["require_2fa_for_admins"] = true
	_ = saveSettings(ctx, s.Store.Pool, cfg)
	a := Actor{User: u, SessionHash: "session", Scope: "admin"}
	for _, p := range []string{"admin/users", "admin/api-keys", "settings", "nodes"} {
		if e := s.authorize(ctx, a, "POST", p); e == nil {
			t.Fatal("2FA bypass", p)
		}
	}
	if e := s.authorize(ctx, a, "GET", "auth/2fa/status"); e != nil {
		t.Fatal("cannot enroll", e)
	}
	a.SessionHash = ""
	if s.authorize(ctx, a, "GET", "auth/me") == nil {
		t.Fatal("API key bypass")
	}
}
func TestIntegrationSubscriptionsFormatsAndClosedEmptyProxies(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	n, i, c := fixture(t, s, ctx, m)
	for _, format := range []string{"base64", "raw", "clash", "json", "portal"} {
		r := httptest.NewRequest("GET", "/sub/"+str(c, "subscription_token")+"?format="+format, nil)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", format, w.Code, w.Body.String())
		}
	}
	for _, p := range []string{"http", "socks"} {
		i["protocol"] = p
		settings, e := inboundSettings(i, n, nil)
		if e != nil || settings != nil {
			t.Fatal("empty proxy opens listener", p, settings, e)
		}
	}
	m.running = false
	if _, e := s.probe(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	fresh, _ := get(ctx, s.Store.Pool, "nodes", num(n, "id"))
	if str(fresh, "status") != "degraded" {
		t.Fatal("stopped runtime healthy", fresh)
	}
}
func TestIntegrationLoginAndSingleUseRecovery(t *testing.T) {
	s, ctx := integration(t)
	u := defaults("users")
	u["username"] = "admin"
	u["is_superuser"] = true
	u["_password"], _ = hashPassword("Very-long-s3cret")
	u["_totp_enabled"] = true
	u["_totp_secret"], _ = seal(s.Config.FieldKey, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
	u["_recovery"] = []any{digest("RECOVERY-CODE")}
	_ = save(ctx, s.Store.Pool, "users", u)
	token := csrfToken(s.Config.SecretKey)
	login := func(code string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"username":"admin","password":"Very-long-s3cret","totp_code":%q}`, code)))
		r.Header.Set("Origin", s.Config.PublicURL)
		r.Header.Set("X-CSRFToken", token)
		r.AddCookie(&http.Cookie{Name: "csrftoken", Value: token})
		s.Handler().ServeHTTP(w, r)
		return w
	}
	if w := login(""); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := login("RECOVERY-CODE"); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := login("RECOVERY-CODE"); w.Code != 401 {
		t.Fatal("recovery replay", w.Code, w.Body.String())
	}
}

func TestIntegrationCrashRecoveryAndProtectedPatch(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	n, _, _ := fixture(t, s, ctx, m)
	ids, _ := json.Marshal([]int64{num(n, "id")})
	op := "crashed-operation-12345"
	if _, e := s.Store.Pool.Exec(ctx, `INSERT INTO vr_operations(id,nodes,created_at) VALUES($1,$2,now()-interval '3 minutes')`, op, string(ids)); e != nil {
		t.Fatal(e)
	}
	if e := s.RecoverOperations(ctx); e != nil {
		t.Fatal(e)
	}
	if m.rollbacks != 1 {
		t.Fatal("orphaned deployment was not compensated")
	}
	n["config_patch"] = Data{"api": Data{"tag": "public"}, "policy": Data{"levels": Data{"0": Data{"statsUserUplink": false}}}, "inbounds": []any{Data{"tag": "api", "listen": "0.0.0.0", "port": 10085}}, "routing": Data{"rules": []any{}}}
	cfg, e := buildConfig(ctx, s.Store.Pool, n)
	if e != nil {
		t.Fatal(e)
	}
	if str(obj(cfg, "api"), "tag") != "api" || !flag(obj(obj(obj(cfg, "policy"), "levels"), "0"), "statsUserUplink") {
		t.Fatal("advanced patch disabled accounting", cfg)
	}
	b, _ := json.Marshal(array(cfg, "inbounds")[0])
	api, _ := decode(b)
	if str(api, "listen") != "127.0.0.1" {
		t.Fatal("API exposed by patch", api)
	}
}
