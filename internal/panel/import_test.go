package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportOutputLimit(t *testing.T) {
	b := &limitedBuffer{max: 4}
	_, err := io.Copy(b, struct{ io.Reader }{strings.NewReader("too large")})
	if err == nil || b.Len() > b.max {
		t.Fatal("import output limit bypassed", err)
	}
}

func TestImportedCredentialsRetainSharedAccountIdentity(t *testing.T) {
	var key string
	for _, protocol := range []string{"vless", "trojan"} {
		row := Data{"source_id": protocol, "name": protocol, "protocol": protocol, "port": 2083, "clients": []any{Data{"name": "shared", "source_account": "user:7", "credential": protocol + "-credential"}}}
		_, clients, _, err := convertImportedInbound(row, "pasarguard", 1)
		if err != nil || len(clients) != 1 {
			t.Fatal("normalization failed", err)
		}
		current := str(clients[0], "_account_key")
		if key != "" && current != key {
			t.Fatal("protocol-specific credentials split a shared account")
		}
		key = current
	}
}

func syntheticBackup(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "xui.db")
	code := `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.executescript('CREATE TABLE inbounds(id INTEGER,remark TEXT,protocol TEXT,port INTEGER,settings TEXT,stream_settings TEXT,enable INTEGER); CREATE TABLE clients(id INTEGER,email TEXT,uuid TEXT,sub_id TEXT,total_gb INTEGER,expiry_time INTEGER,enable INTEGER); CREATE TABLE client_inbounds(client_id INTEGER,inbound_id INTEGER); CREATE TABLE client_traffics(inbound_id INTEGER,email TEXT,up INTEGER,down INTEGER);')
c.execute('insert into clients values(1,?,?,?,?,?,?)',('shared','11111111-1111-4111-8111-111111111111','original_source_token_1234',10000,0,1))
for i,p in [(1,2083),(2,2087)]:
 s={'clients':[{'id':'11111111-1111-4111-8111-111111111111','email':'shared','subId':'original_source_token_1234','totalGB':10000,'enable':True}],'decryption':'none'}
 c.execute('insert into inbounds values(?,?,?,?,?,?,?)',(i,'source-'+str(i),'vless',p,json.dumps(s),json.dumps({'network':'ws','security':'none','wsSettings':{'path':'/source','headers':{'Host':'edge.example'}}}),1));c.execute('insert into client_inbounds values(1,?)',(i,))
c.execute('insert into client_traffics values(1,?,?,?)',('shared',100,200));c.commit()`
	if out, e := exec.Command("python3", "-I", "-c", code, path).CombinedOutput(); e != nil {
		t.Fatal(e, string(out))
	}
	return path
}

func importActor(t *testing.T, s *Server, ctx context.Context) Actor {
	t.Helper()
	user := defaults("users")
	user["username"], user["is_superuser"] = "import-admin", true
	if e := save(ctx, s.Store.Pool, "users", user); e != nil {
		t.Fatal(e)
	}
	return Actor{User: user, Scope: "admin"}
}
func importPreview(t *testing.T, s *Server, ctx context.Context, a Actor, node int64, path string) Data {
	t.Helper()
	raw, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	_ = writer.WriteField("node", fmt.Sprint(node))
	part, e := writer.CreateFormFile("file", "backup.db")
	if e != nil {
		t.Fatal(e)
	}
	_, _ = part.Write(raw)
	_ = writer.Close()
	req := httptest.NewRequest("POST", "/api/imports/preview", &buffer).WithContext(ctx)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	result, _, e := s.importsAPI(httptest.NewRecorder(), req, "imports/preview", a)
	if e != nil {
		t.Fatal(e)
	}
	return result.(Data)
}
func importCommit(s *Server, ctx context.Context, a Actor, p Data, overrides Data) (Data, error) {
	selection := []string{}
	for _, v := range array(p, "inbounds") {
		row := asData(v)
		if flag(row, "supported") {
			selection = append(selection, str(row, "source_id"))
		}
	}
	b, _ := json.Marshal(Data{"token": p["token"], "selected": selection, "port_overrides": overrides})
	req := httptest.NewRequest("POST", "/api/imports/commit", bytes.NewReader(b)).WithContext(ctx)
	result, _, e := s.importsAPI(httptest.NewRecorder(), req, "imports/commit", a)
	if e != nil {
		return nil, e
	}
	return result.(Data), nil
}

func TestExternalReaderRecognizesSharedXUIAndPasarGuard(t *testing.T) {
	source, e := readExternalBackup(context.Background(), syntheticBackup(t))
	if e != nil {
		t.Fatal(e)
	}
	if str(source, "source") != "3x-ui" || len(array(source, "inbounds")) != 2 {
		t.Fatal("source format not recognized")
	}
	for _, v := range array(source, "inbounds") {
		row := asData(v)
		c := asData(array(row, "clients")[0])
		if str(c, "source_account") == "" || num(c, "used_traffic_bytes") != 300 {
			t.Fatal("shared traffic was not preserved")
		}
	}
	path := filepath.Join(t.TempDir(), "pasarguard.json")
	raw := `{"tables":{"users":[{"id":7,"username":"migrated","proxy_settings":{"vless":{"id":"11111111-1111-4111-8111-111111111111"}},"used_traffic":500,"data_limit":10000,"status":"active","expire":"2030-01-01T00:00:00Z"}],"inbounds":[{"id":2,"tag":"vless"}],"users_groups_association":[{"user_id":7,"groups_id":1}],"inbounds_groups_association":[{"inbound_id":2,"group_id":1}],"core_configs":[{"id":1,"type":"xray","config":{"inbounds":[{"tag":"vless","protocol":"vless","port":2096,"settings":{"decryption":"none"},"streamSettings":{"network":"tcp","security":"none"}}]}}],"user_usage_logs":[{"user_id":7,"used_traffic_at_reset":1000}]}}`
	_ = os.WriteFile(path, []byte(raw), 0600)
	source, e = readExternalBackup(context.Background(), path)
	if e != nil {
		t.Fatal(e)
	}
	row := asData(array(source, "inbounds")[0])
	c := asData(array(row, "clients")[0])
	if str(source, "source") != "pasarguard" || num(c, "used_traffic_bytes") != 500 || num(c, "lifetime_traffic_bytes") != 1500 {
		t.Fatal("PasarGuard counters or group membership changed")
	}
	_ = os.WriteFile(path, []byte("DROP TABLE users;"), 0600)
	if _, e = readExternalBackup(context.Background(), path); e == nil {
		t.Fatal("SQL dump was accepted")
	}
}

func TestIntegrationImportPreservesSharedQuotaAndMultipleConnections(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	n, _, _ := fixture(t, s, ctx, m)
	a := importActor(t, s, ctx)
	p := importPreview(t, s, ctx, a, num(n, "id"), syntheticBackup(t))
	if num(p, "accounts") != 1 || num(p, "client_links") != 2 || num(p, "used_traffic_bytes") != 300 {
		t.Fatal("preview double-counted usage")
	}
	result, e := importCommit(s, ctx, a, p, Data{})
	if e != nil {
		t.Fatal(e)
	}
	if num(result, "inbounds_created") != 2 || m.applies != 0 {
		t.Fatal("import unexpectedly deployed runtime")
	}
	clients, e := list(ctx, s.Store.Pool, "clients", "WHERE account_id IS NOT NULL ORDER BY id")
	if e != nil || len(clients) != 2 {
		t.Fatal("membership lost", e)
	}
	if _, e = importCommit(s, ctx, a, p, Data{}); e != nil {
		t.Fatal("retry failed", e)
	}
	p2 := importPreview(t, s, ctx, a, num(n, "id"), syntheticBackup(t))
	r2, e := importCommit(s, ctx, a, p2, Data{})
	if e != nil || num(r2, "inbounds_skipped") != 2 || num(r2, "client_links_created") != 0 {
		t.Fatal("repeated backup duplicated records", e)
	}
	for _, c := range clients {
		if num(c, "used_traffic_bytes") != 300 || num(c, "raw_used_traffic_bytes") != 300 || num(c, "_account") < 1 {
			t.Fatal("counter or shared account lost")
		}
		i, e := get(ctx, s.Store.Pool, "inbounds", num(c, "inbound"))
		if e != nil || flag(i, "enabled") {
			t.Fatal("inbound was activated")
		}
		i["enabled"] = true
		if e = save(ctx, s.Store.Pool, "inbounds", i); e != nil {
			t.Fatal(e)
		}
	}
	view, e := s.view(ctx, s.Store.Pool, "clients", clients[1])
	if e != nil || !strings.HasSuffix(str(view, "subscription_url"), "original_source_token_1234") {
		t.Fatal("original subscription token lost")
	}
	req := httptest.NewRequest("GET", "/sub/original_source_token_1234?format=raw", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	s.subscription(w, req)
	if w.Code != 200 || strings.Count(w.Body.String(), "vless://") != 2 {
		t.Fatal("subscription did not contain both connections")
	}
	group := clients[0]
	group["traffic_multiplier"] = json.Number("-0.5")
	if e = save(ctx, s.Store.Pool, "clients", group); e != nil {
		t.Fatal(e)
	}
	m.stats = []any{}
	for _, c := range clients {
		m.stats = append(m.stats, Data{"name": fmt.Sprintf("user>>>veloray:%d:shared>>>traffic>>>uplink", num(c, "id")), "value": 100})
	}
	if e = s.reconcileNode(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	for _, c := range clients {
		fresh, e := get(ctx, s.Store.Pool, "clients", num(c, "id"))
		if e != nil || num(fresh, "used_traffic_bytes") != 400 || num(fresh, "raw_used_traffic_bytes") != 500 {
			t.Fatal("shared usage was not aggregated once", e)
		}
	}
	req = httptest.NewRequest("POST", "/", strings.NewReader("{}")).WithContext(ctx)
	if _, _, e = s.action(httptest.NewRecorder(), req, "clients", num(group, "id"), "reset-usage", a); e != nil {
		t.Fatal(e)
	}
	for _, c := range clients {
		fresh, _ := get(ctx, s.Store.Pool, "clients", num(c, "id"))
		if num(fresh, "used_traffic_bytes") != 0 || num(fresh, "raw_used_traffic_bytes") != 0 || num(fresh, "raw_lifetime_traffic_bytes") != 500 {
			t.Fatal("shared reset lost history")
		}
	}
}

func TestIntegrationImportPortConflictIsAtomic(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	n, _, _ := fixture(t, s, ctx, m)
	a := importActor(t, s, ctx)
	p := importPreview(t, s, ctx, a, num(n, "id"), syntheticBackup(t))
	if _, e := importCommit(s, ctx, a, p, Data{"2": 443}); e == nil {
		t.Fatal("port collision was accepted")
	}
	var count int
	_ = s.Store.Pool.QueryRow(ctx, `SELECT count(*) FROM vr_inbounds WHERE node_id=$1`, num(n, "id")).Scan(&count)
	if count != 1 || m.applies != 0 {
		t.Fatal("failed import left partial records")
	}
	if _, e := importCommit(s, ctx, a, p, Data{"2": 2053}); e != nil {
		t.Fatal("corrected import could not be retried", e)
	}
}

func TestIntegrationRealSuppliedBackup(t *testing.T) {
	path := os.Getenv("VELORAY_TEST_IMPORT_DB")
	if path == "" {
		t.Skip("set VELORAY_TEST_IMPORT_DB to verify the supplied backup")
	}
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	n, _, _ := fixture(t, s, ctx, m)
	a := importActor(t, s, ctx)
	p := importPreview(t, s, ctx, a, num(n, "id"), path)
	if num(p, "accounts") != 1 || num(p, "client_links") != 5 || len(array(p, "inbounds")) != 5 {
		t.Fatal("unexpected supplied backup mapping")
	}
	for _, v := range array(p, "inbounds") {
		if !flag(asData(v), "supported") {
			t.Fatal("supplied inbound was not recognized")
		}
	}
	if _, e := importCommit(s, ctx, a, p, Data{"7": 2053}); e != nil {
		t.Fatal("supplied backup could not be imported", e)
	}
	clients, e := list(ctx, s.Store.Pool, "clients", "WHERE account_id IS NOT NULL")
	if e != nil || len(clients) != 5 {
		t.Fatal("supplied clients lost", e)
	}
	for _, c := range clients {
		if num(c, "used_traffic_bytes") != 0 || num(c, "_account") != num(clients[0], "_account") {
			t.Fatal("supplied usage was duplicated")
		}
	}
}

func TestImportAccessControl(t *testing.T) {
	s := &Server{}
	r := httptest.NewRequest("POST", "/api/imports/preview", nil)
	if _, _, e := s.importsAPI(httptest.NewRecorder(), r, "imports/preview", Actor{User: Data{"is_superuser": true}, Scope: "read"}); e == nil {
		t.Fatal("read-only key can import")
	}
}
