package panel

import (
	"bytes"
	"context"
	"crypto/ecdh"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

//go:embed import_reader.py
var importReader string

const importMaxBytes = 64 << 20

func publicX25519(private string) string {
	b, e := base64.RawURLEncoding.DecodeString(private)
	if e != nil {
		b, e = base64.StdEncoding.DecodeString(private)
	}
	if e != nil {
		return ""
	}
	key, e := ecdh.X25519().NewPrivateKey(b)
	if e != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes())
}

type limitedBuffer struct {
	buffer bytes.Buffer
	max    int
}

func (b *limitedBuffer) Len() int      { return b.buffer.Len() }
func (b *limitedBuffer) Bytes() []byte { return b.buffer.Bytes() }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.max {
		return 0, errors.New("import output exceeds the limit")
	}
	return b.buffer.Write(p)
}

func readExternalBackup(ctx context.Context, path string) (Data, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "python3", "-I", "-c", importReader, path)
	stdout := &limitedBuffer{max: 32 << 20}
	stderr := &limitedBuffer{max: 2048}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("backup inspection timed out")
		}
		if errors.Is(err, exec.ErrNotFound) {
			return nil, errors.New("Python 3 is required; rerun the VeloRay installer")
		}
		return nil, errors.New("Backup is invalid, too large or unsupported. Use a SQLite backup or the documented PasarGuard JSON export")
	}
	return decode(stdout.Bytes())
}

func asData(value any) Data {
	switch d := value.(type) {
	case map[string]any:
		return Data(d)
	case Data:
		return d
	}
	return Data{}
}

func importedExpiry(value any) (any, string) {
	if value == nil || fmt.Sprint(value) == "0" || fmt.Sprint(value) == "" {
		return nil, ""
	}
	if v, ok := value.(json.Number); ok {
		n, err := v.Int64()
		if err != nil {
			return nil, "Invalid source expiry; review the account"
		}
		if n < 0 {
			return nil, "On-hold expiry needs a manual activation date"
		}
		if n > 100000000000 {
			return stamp(time.UnixMilli(n)), ""
		}
		return stamp(time.Unix(n, 0)), ""
	}
	t := fmt.Sprint(value)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999-07:00", "2006-01-02 15:04:05.999999", "2006-01-02T15:04:05.999999"} {
		if parsed, err := time.Parse(layout, t); err == nil {
			return stamp(parsed), ""
		}
	}
	return nil, "Invalid source expiry; review the account"
}

func convertImportedInbound(row Data, source string, nodeID int64) (Data, []Data, []string, error) {
	i := defaults("inbounds")
	for _, key := range []string{"name", "listen", "port", "protocol"} {
		if v, ok := row[key]; ok {
			i[key] = v
		}
	}
	i["name"] = string([]rune(str(i, "name"))[:min(96, len([]rune(str(i, "name"))))])
	i["node"], i["enabled"] = nodeID, false
	i["_source_id"], i["_source_panel"] = str(row, "source_id"), source
	i["_source_key"] = digest(source + ":" + str(row, "source_id") + ":" + str(i, "name") + ":" + fmt.Sprint(i["port"]) + ":" + str(i, "protocol"))
	i["_source_enabled"] = flag(row, "enabled")
	ps, stream := obj(row, "settings"), clone(obj(row, "stream_settings"))
	p := str(i, "protocol")
	if !oneOf(p, "vless", "vmess", "trojan", "shadowsocks", "http", "socks", "hysteria") {
		return nil, nil, nil, errors.New("Protocol is not supported by the migration adapter")
	}
	t := fallback(str(stream, "network"), fallback(str(stream, "method"), "raw"))
	if mapped := (map[string]string{"tcp": "raw", "websocket": "ws", "splithttp": "xhttp", "kcp": "mkcp"})[t]; mapped != "" {
		t = mapped
	}
	if !oneOf(t, "raw", "ws", "grpc", "xhttp", "httpupgrade", "mkcp", "hysteria") {
		return nil, nil, nil, errors.New("Transport is not supported by the migration adapter")
	}
	i["transport"], i["security"] = t, fallback(str(stream, "security"), "none")
	if !oneOf(str(i, "security"), "none", "tls", "reality") {
		return nil, nil, nil, errors.New("Stream security is not supported")
	}
	warnings := []string{}
	if num(i, "port") < 1 || num(i, "port") > 65535 {
		return nil, nil, nil, errors.New("Source port is invalid")
	}
	if str(i, "listen") == "" {
		i["listen"] = "0.0.0.0"
	}
	switch t {
	case "ws", "httpupgrade", "xhttp":
		key := map[string]string{"ws": "wsSettings", "httpupgrade": "httpupgradeSettings", "xhttp": "xhttpSettings"}[t]
		v := obj(stream, key)
		if len(v) == 0 && t == "xhttp" {
			v = obj(stream, "splithttpSettings")
		}
		i["path"], i["host_header"] = fallback(str(v, "path"), "/"), fallback(str(v, "host"), str(obj(v, "headers"), "Host"))
		if t == "xhttp" {
			stream["xhttpSettings"] = v
			delete(stream, "splithttpSettings")
		}
	case "grpc":
		i["service_name"] = str(obj(stream, "grpcSettings"), "serviceName")
	}
	if str(i, "security") == "tls" {
		v := obj(stream, "tlsSettings")
		i["tls_server_name"] = str(v, "serverName")
		certs := array(v, "certificates")
		if len(certs) > 0 {
			cert := asData(certs[0])
			i["tls_cert_file"], i["tls_key_file"] = str(cert, "certificateFile"), str(cert, "keyFile")
		}
		warnings = append(warnings, "Verify that the TLS certificate and private-key files exist and are readable on the target node")
		for _, cert := range certs {
			v := asData(cert)
			if len(array(v, "certificate")) > 0 || len(array(v, "key")) > 0 {
				return nil, nil, nil, errors.New("Inline TLS material must be replaced with target-node certificate files")
			}
		}
	}
	if str(i, "security") == "reality" {
		v := obj(stream, "realitySettings")
		i["reality_dest"] = fallback(str(v, "target"), str(v, "dest"))
		i["reality_private_key"] = str(v, "privateKey")
		if names := array(v, "serverNames"); len(names) > 0 {
			i["reality_server_name"], _ = names[0].(string)
		}
		if ids := array(v, "shortIds"); len(ids) > 0 {
			i["reality_short_id"], _ = ids[0].(string)
		}
		i["reality_public_key"] = fallback(str(obj(v, "settings"), "publicKey"), str(v, "publicKey"))
		if str(i, "reality_public_key") == "" {
			i["reality_public_key"] = publicX25519(str(i, "reality_private_key"))
		}
	}
	delete(stream, "security")
	delete(stream, "network")
	delete(stream, "method")
	delete(stream, "externalProxy")
	i["stream_settings"] = stream
	if p == "shadowsocks" {
		i["protocol_settings"] = Data{"method": ps["method"]}
	}
	if p == "vless" && str(ps, "decryption") != "" && str(ps, "decryption") != "none" {
		return nil, nil, nil, errors.New("VLESS encrypted decryption settings require manual migration")
	}
	if len(array(ps, "fallbacks")) > 0 {
		warnings = append(warnings, "Fallback chains require manual configuration and are not activated")
	}
	cs := []Data{}
	for index, value := range array(row, "clients") {
		c := defaults("clients")
		original := asData(value)
		for _, key := range []string{"name", "credential", "enabled", "traffic_limit_bytes", "used_traffic_bytes", "lifetime_traffic_bytes", "note", "subscription_token", "protocol_settings"} {
			if v, ok := original[key]; ok {
				c[key] = v
			}
		}
		if str(c, "credential") == "" {
			return nil, nil, nil, fmt.Errorf("Client %d has no source credential", index+1)
		}
		if len([]rune(str(c, "name"))) > 96 {
			return nil, nil, nil, errors.New("Client name exceeds 96 characters")
		}
		var message string
		c["expires_at"], message = importedExpiry(original["expires_at"])
		if message != "" {
			c["enabled"] = false
			c["disabled_reason"] = "import-review"
			warnings = append(warnings, message)
		}
		for _, key := range []string{"used_traffic_bytes", "lifetime_traffic_bytes", "traffic_limit_bytes"} {
			if num(c, key) < 0 {
				return nil, nil, nil, errors.New("Negative source traffic counters are not accepted")
			}
		}
		c["raw_used_traffic_bytes"], c["raw_lifetime_traffic_bytes"] = num(c, "used_traffic_bytes"), num(c, "lifetime_traffic_bytes")
		c["_source_account"], c["_source_meta"] = str(original, "source_account"), original["source_meta"]
		if key := str(c, "_source_account"); key != "" {
			c["_account_key"] = digest(source + ":" + key + ":" + str(c, "name"))
		}
		cs = append(cs, c)
	}
	return i, cs, warnings, nil
}

func (s *Server) importsAPI(w http.ResponseWriter, r *http.Request, path string, a Actor) (any, int, error) {
	if !flag(a.User, "is_superuser") || a.Scope != "admin" {
		return nil, 0, fail(403, "administrator access required")
	}
	if r.Method != "POST" {
		return nil, 0, fail(405, "method not allowed")
	}
	if path == "imports/preview" {
		return s.previewImport(w, r, a)
	}
	if path == "imports/commit" {
		return s.commitImport(w, r, a)
	}
	return nil, 0, fail(404, "import endpoint not found")
}

func (s *Server) previewImport(w http.ResponseWriter, r *http.Request, a Actor) (any, int, error) {
	ctx := r.Context()
	if e := rateLimit(ctx, s.Store.Pool, fmt.Sprintf("import:%d", num(a.User, "id")), 10, 5*time.Minute); e != nil {
		return nil, 0, e
	}
	r.Body = http.MaxBytesReader(w, r.Body, importMaxBytes+1<<20)
	defer r.Body.Close()
	reader, e := r.MultipartReader()
	if e != nil {
		return nil, 0, fail(400, "Select a backup file and a target node")
	}
	dir, e := os.MkdirTemp("", "veloray-import-")
	if e != nil {
		return nil, 0, e
	}
	defer os.RemoveAll(dir)
	path := dir + "/source.backup"
	var nodeID int64
	var copied int64
	hasFile := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, 0, fail(400, "Backup upload failed or exceeded 64 MiB")
		}
		switch part.FormName() {
		case "node":
			b, err := io.ReadAll(io.LimitReader(part, 64))
			if err != nil {
				return nil, 0, err
			}
			nodeID, _ = strconv.ParseInt(string(b), 10, 64)
		case "file":
			if hasFile {
				return nil, 0, fail(400, "Upload one backup at a time")
			}
			hasFile = true
			f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return nil, 0, err
			}
			copied, err = io.Copy(f, io.LimitReader(part, importMaxBytes+1))
			closeErr := f.Close()
			if err != nil || closeErr != nil || copied > importMaxBytes {
				return nil, 0, fail(400, "Backup exceeds 64 MiB or could not be read")
			}
		default:
			return nil, 0, fail(400, "Unexpected upload field")
		}
		part.Close()
	}
	if !hasFile || copied == 0 || nodeID < 1 {
		return nil, 0, fail(400, "Select a backup file and a target node")
	}
	node, e := get(ctx, s.Store.Pool, "nodes", nodeID)
	if e != nil {
		return nil, 0, e
	}
	source, e := readExternalBackup(ctx, path)
	if e != nil {
		return nil, 0, fail(400, e.Error())
	}
	entries := []any{}
	normalized := []any{}
	accounts := map[string]bool{}
	usedTotal := int64(0)
	links := 0
	existing, e := list(ctx, s.Store.Pool, "inbounds", "WHERE node_id=$1", nodeID)
	if e != nil {
		return nil, 0, e
	}
	for _, value := range array(source, "inbounds") {
		row := asData(value)
		i, cs, warnings, err := convertImportedInbound(row, str(source, "source"), nodeID)
		entry := Data{"source_id": str(row, "source_id"), "name": str(row, "name"), "port": num(row, "port"), "protocol": str(row, "protocol"), "supported": err == nil, "client_count": len(array(row, "clients")), "warnings": warnings, "existing_id": 0, "conflict_id": 0}
		if err != nil {
			entry["warnings"] = []string{err.Error()}
			entries = append(entries, entry)
			continue
		}
		entry["transport"], entry["security"] = i["transport"], i["security"]
		for _, old := range existing {
			if str(old, "_source_key") == str(i, "_source_key") {
				entry["existing_id"] = num(old, "id")
			} else if num(old, "port") == num(i, "port") {
				entry["conflict_id"] = num(old, "id")
			}
		}
		if err := validateInbound(ctx, s.Store.Pool, s.Config, i); err != nil {
			warnings = append(warnings, err.Error())
		}
		entry["warnings"] = warnings
		for _, c := range cs {
			key := str(c, "_source_account")
			if key == "" {
				key = str(row, "source_id") + ":" + str(c, "name")
			}
			if !accounts[key] {
				accounts[key] = true
				usedTotal += num(c, "used_traffic_bytes")
			}
			links++
		}
		normalized = append(normalized, Data{"inbound": i, "clients": cs})
		entries = append(entries, entry)
	}
	checks := []any{}
	for _, value := range normalized {
		i := obj(asData(value), "inbound")
		checks = append(checks, Data{"tag": "import-" + str(i, "_source_id"), "listen": i["listen"], "port": i["port"], "protocol": i["protocol"], "settings": Data{}, "streamSettings": Data{"network": i["transport"]}})
	}
	portReport, portErr := s.nodeCall(ctx, node, "/xray/ports", Data{"config": Data{"inbounds": checks}})
	if portErr != nil {
		source["warnings"] = append(array(source, "warnings"), "Live port inspection is unavailable; check the target node before activation")
	} else {
		for _, checkValue := range array(portReport, "ports") {
			check := asData(checkValue)
			for _, entryValue := range entries {
				entry := asData(entryValue)
				if "import-"+str(entry, "source_id") == str(check, "tag") {
					if str(check, "state") == "conflict" || str(entry, "port_state") == "" {
						entry["port_state"], entry["port_owner"] = check["state"], check["owner"]
					}
				}
			}
		}
	}
	preview := Data{"source": str(source, "source"), "node": nodeID, "node_name": str(node, "name"), "inbounds": entries, "accounts": len(accounts), "client_links": links, "used_traffic_bytes": usedTotal, "warnings": source["warnings"], "activation": "disabled", "expires_in_seconds": 1800}
	b, _ := json.Marshal(Data{"entries": normalized})
	sealed, e := seal(s.Config.FieldKey, string(b))
	if e != nil {
		return nil, 0, e
	}
	raw, _ := os.ReadFile(path)
	fileDigest := digest(string(raw))
	token := randomToken(32)
	pb, _ := json.Marshal(preview)
	if _, e = s.Store.Pool.Exec(ctx, `INSERT INTO vr_import_jobs(id,actor_id,node_id,digest,payload,preview) VALUES($1,$2,$3,$4,$5,$6)`, token, num(a.User, "id"), nodeID, fileDigest, sealed, string(pb)); e != nil {
		return nil, 0, e
	}
	preview["token"] = token
	return preview, 200, nil
}

func (s *Server) commitImport(w http.ResponseWriter, r *http.Request, a Actor) (any, int, error) {
	input, e := readBody(w, r)
	if e != nil {
		return nil, 0, e
	}
	if e = allowed(input, "token selected port_overrides"); e != nil {
		return nil, 0, fail(400, e.Error())
	}
	token := str(input, "token")
	selection := array(input, "selected")
	if len(token) < 16 || len(selection) < 1 || len(selection) > 500 {
		return nil, 0, fail(400, "Preview the backup and select inbounds first")
	}
	selected := map[string]bool{}
	for _, v := range selection {
		key, ok := v.(string)
		if !ok || key == "" || selected[key] {
			return nil, 0, fail(400, "Invalid inbound selection")
		}
		selected[key] = true
	}
	ctx := r.Context()
	tx, e := s.Store.Pool.Begin(ctx)
	if e != nil {
		return nil, 0, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(842100,2)`); e != nil {
		return nil, 0, e
	}
	var payload string
	var nodeID int64
	var expires time.Time
	var previous []byte
	e = tx.QueryRow(ctx, `SELECT payload,node_id,expires_at,result FROM vr_import_jobs WHERE id=$1 AND actor_id=$2 FOR UPDATE`, token, num(a.User, "id")).Scan(&payload, &nodeID, &expires, &previous)
	if e != nil {
		return nil, 0, fail(404, "Import preview was not found")
	}
	if len(previous) > 0 {
		d, e := decode(previous)
		return d, 200, e
	}
	if time.Now().After(expires) {
		return nil, 0, fail(410, "Import preview expired; upload the backup again")
	}
	if e = lockNodes(ctx, tx, nodeID); e != nil {
		return nil, 0, e
	}
	plain, e := unseal(s.Config.FieldKey, payload)
	if e != nil {
		return nil, 0, e
	}
	data, e := decode([]byte(plain))
	if e != nil {
		return nil, 0, e
	}
	existing, e := list(ctx, tx, "inbounds", "WHERE node_id=$1", nodeID)
	if e != nil {
		return nil, 0, e
	}
	ports := map[int64]bool{}
	keys := map[string]bool{}
	for _, old := range existing {
		ports[num(old, "port")] = true
		keys[str(old, "_source_key")] = true
	}
	overrides := obj(input, "port_overrides")
	groups := map[string]int64{}
	created, links, skipped := 0, 0, 0
	createdIDs := []any{}
	for _, entry := range array(data, "entries") {
		v := asData(entry)
		i := obj(v, "inbound")
		sourceID := str(i, "_source_id")
		if !selected[sourceID] {
			continue
		}
		delete(selected, sourceID)
		if keys[str(i, "_source_key")] {
			skipped++
			continue
		}
		if override, ok := overrides[sourceID]; ok {
			number, ok := override.(json.Number)
			if !ok {
				return nil, 0, fail(400, "Port overrides must be integers")
			}
			port, err := number.Int64()
			if err != nil || port < 1 || port > 65535 {
				return nil, 0, fail(400, "Port overrides must be 1–65535")
			}
			i["port"] = port
		}
		port := num(i, "port")
		if ports[port] {
			return nil, 0, fail(409, fmt.Sprintf("Port %d already belongs to an inbound; choose another port", port))
		}
		ports[port] = true
		// Disabled imports are staged without touching any running node or its configuration.
		i["enabled"] = false
		if e = save(ctx, tx, "inbounds", i); e != nil {
			return nil, 0, databaseError(e)
		}
		created++
		createdIDs = append(createdIDs, num(i, "id"))
		for _, value := range array(v, "clients") {
			c := asData(value)
			c["inbound"] = num(i, "id")
			key := str(c, "_source_account")
			if key != "" {
				accountID := groups[key]
				if accountID == 0 {
					e = tx.QueryRow(ctx, `SELECT id FROM vr_accounts WHERE node_id=$1 AND data->>'_source_key'=$2`, nodeID, str(c, "_account_key")).Scan(&accountID)
					if errors.Is(e, pgx.ErrNoRows) {
						shared := Data{"_node": nodeID, "_source_key": str(c, "_account_key")}
						for _, field := range accountFields {
							if val, ok := c[field]; ok {
								shared[field] = val
							}
						}
						b, _ := json.Marshal(shared)
						e = tx.QueryRow(ctx, `INSERT INTO vr_accounts(data) VALUES($1) RETURNING id`, string(b)).Scan(&accountID)
					}
					if e != nil {
						return nil, 0, e
					}
					groups[key] = accountID
				} else {
					c["subscription_token"] = ""
				}
				c["_account"] = accountID
				if e = hydrateClient(ctx, tx, c, nil); e != nil {
					return nil, 0, e
				}
			}
			if !subscriptionTokenPattern.MatchString(str(c, "subscription_token")) {
				c["subscription_token"] = randomToken(32)
			}
			var tokenExists bool
			if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vr_clients WHERE data->>'subscription_token'=$1)`, str(c, "subscription_token")).Scan(&tokenExists); e != nil {
				return nil, 0, e
			}
			if tokenExists {
				c["subscription_token"] = randomToken(32)
			}
			if e = validateClient(ctx, tx, c); e != nil {
				return nil, 0, fail(400, "Source client could not be imported: "+e.Error())
			}
			if e = save(ctx, tx, "clients", c); e != nil {
				return nil, 0, databaseError(e)
			}
			links++
		}
	}
	if len(selected) > 0 {
		return nil, 0, fail(400, "Selection contains unsupported or unknown inbounds")
	}
	result := Data{"status": "imported-disabled", "inbounds_created": created, "client_links_created": links, "shared_accounts": len(groups), "inbounds_skipped": skipped, "inbound_ids": createdIDs}
	b, _ := json.Marshal(result)
	if _, e = tx.Exec(ctx, `UPDATE vr_import_jobs SET result=$1,payload='' WHERE id=$2`, string(b), token); e != nil {
		return nil, 0, e
	}
	if e = audit(ctx, tx, num(a.User, "id"), "import.commit", fmt.Sprintf("%d inbounds", created), result); e != nil {
		return nil, 0, e
	}
	return result, 201, tx.Commit(ctx)
}
