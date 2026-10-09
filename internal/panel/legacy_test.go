package panel

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func fernetFixture(key, plain string) string {
	derived := sha256.Sum256([]byte(key))
	p := []byte(plain)
	padding := 16 - len(p)%16
	for j := 0; j < padding; j++ {
		p = append(p, byte(padding))
	}
	raw := make([]byte, 25+len(p))
	raw[0] = 0x80
	block, _ := aes.NewCipher(derived[16:])
	cipher.NewCBCEncrypter(block, raw[9:25]).CryptBlocks(raw[25:], p)
	mac := hmac.New(sha256.New, derived[:16])
	mac.Write(raw)
	return base64.URLEncoding.EncodeToString(append(raw, mac.Sum(nil)...))
}
func TestLegacyFernetAuthenticatedCompatibility(t *testing.T) {
	key := "legacy-field-key"
	token := fernetFixture(key, "agent-secret")
	plain, e := legacyFernet(key, token)
	if e != nil || plain != "agent-secret" {
		t.Fatal(plain, e)
	}
	if _, e = legacyFernet("wrong", token); e == nil {
		t.Fatal("legacy key mismatch ignored")
	}
}
func TestIntegrationLegacyImportIsTransactional(t *testing.T) {
	s, ctx := integration(t) // Minimal schemas cover row_to_json import boundaries.
	_, e := s.Store.Pool.Exec(ctx, `CREATE TABLE auth_user(id bigint PRIMARY KEY,username text,password text,is_active boolean,is_staff boolean,is_superuser boolean,email text,date_joined timestamptz); CREATE TABLE core_node(id bigint PRIMARY KEY,name text,public_host text,agent_url text,agent_token_enc text,enabled boolean,is_local boolean,verify_tls boolean);CREATE TABLE core_client(id bigint PRIMARY KEY,inbound_id bigint,name text,credential text,subscription_token text,enabled boolean,used_traffic_bytes bigint);CREATE TABLE core_inbound(id bigint PRIMARY KEY,node_id bigint,name text,listen text,port integer,protocol text,transport text,security text,enabled boolean)`)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		_, _ = s.Store.Pool.Exec(context.Background(), `DROP TABLE auth_user,core_node,core_client,core_inbound`)
	})
	_, e = s.Store.Pool.Exec(ctx, `INSERT INTO auth_user VALUES(7,'legacy','pbkdf2_sha256$1000$salt$invalid',true,true,true,'',now());INSERT INTO core_inbound VALUES(11,9,'main','0.0.0.0',443,'vless','raw','none',true);INSERT INTO core_client VALUES(13,11,'alice','123','persistent-sub-token',true,100)`)
	if e != nil {
		t.Fatal(e)
	}
	encrypted := fernetFixture(s.Config.FieldKey, "agent-secret-that-is-long-enough")
	_, e = s.Store.Pool.Exec(ctx, `INSERT INTO core_node VALUES(9,'Local Node','vpn.example','http://127.0.1.0:9191',$1,true,true,true)`, encrypted)
	if e != nil {
		t.Fatal(e)
	}
	out, e := s.Store.ImportLegacy(ctx, s.Config, true)
	if e != nil || num(out, "clients") != 1 {
		t.Fatal(out, e)
	}
	var count int
	_ = s.Store.Pool.QueryRow(ctx, `SELECT count(*) FROM vr_users`).Scan(&count)
	if count != 0 {
		t.Fatal("dry run committed")
	}
	bad := s.Config
	bad.FieldKey = "wrong-key"
	if _, e = s.Store.ImportLegacy(ctx, bad, false); e == nil {
		t.Fatal("wrong field key imported")
	}
	out, e = s.Store.ImportLegacy(ctx, s.Config, false)
	if e != nil {
		t.Fatal(e)
	}
	n, e := get(ctx, s.Store.Pool, "nodes", 9)
	if e != nil || str(n, "agent_url") != "http://127.0.0.1:9191" {
		t.Fatal(n, e)
	}
	c, e := get(ctx, s.Store.Pool, "clients", 13)
	if e != nil || str(c, "subscription_token") != "persistent-sub-token" || num(c, "used_traffic_bytes") != 100 {
		t.Fatal(c, e)
	}
	fresh := defaults("clients")
	fresh["inbound"] = 11
	fresh["name"] = "next"
	fresh["subscription_token"] = "new-sub-token"
	if e = save(ctx, s.Store.Pool, "clients", fresh); e != nil || num(fresh, "id") <= 13 {
		t.Fatal("sequence not advanced", fresh, e)
	}
	if _, e = s.Store.ImportLegacy(ctx, s.Config, false); e == nil {
		t.Fatal("duplicate import allowed")
	}
}

var _ = json.Marshal
var _ = time.Now
