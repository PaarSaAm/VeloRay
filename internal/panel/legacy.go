package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
)

func legacyRows(ctx context.Context, q Query, table string) ([]Data, error) {
	var exists bool
	if e := q.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists); e != nil {
		return nil, e
	}
	if !exists {
		return []Data{}, nil
	}
	rows, e := q.Query(ctx, "SELECT row_to_json(t) FROM "+table+" t ORDER BY id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Data{}
	for rows.Next() {
		var raw []byte
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		d, e := decode(raw)
		if e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
func (s *Store) ImportLegacy(ctx context.Context, c Config, dryRun bool) (Data, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(842100,2)`); e != nil {
		return nil, e
	}
	var existing int
	if e = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM vr_nodes)+(SELECT count(*) FROM vr_users)+(SELECT count(*) FROM vr_clients)`).Scan(&existing); e != nil {
		return nil, e
	}
	if existing > 0 {
		return nil, errors.New("legacy import requires empty Go tables; legacy tables are left intact")
	}
	count := Data{}
	security, e := legacyRows(ctx, tx, "core_usersecurity")
	if e != nil {
		return nil, e
	}
	secs := map[int64]Data{}
	for _, v := range security {
		secs[num(v, "user_id")] = v
	}
	decrypt := func(value string) (string, error) {
		if value == "" {
			return "", nil
		}
		plain, e := legacyFernet(c.FieldKey, value)
		if e != nil {
			return "", fmt.Errorf("legacy secrets cannot be decrypted with VELORAY_FIELD_KEY: %w", e)
		}
		return seal(c.FieldKey, plain)
	}
	for _, pair := range [][2]string{{"users", "auth_user"}, {"nodes", "core_node"}, {"inbounds", "core_inbound"}, {"clients", "core_client"}, {"api_keys", "core_apikey"}, {"audit", "core_auditevent"}} {
		kind, table := pair[0], pair[1]
		rows, e := legacyRows(ctx, tx, table)
		if e != nil {
			return nil, e
		}
		count[kind] = len(rows)
		for _, row := range rows {
			d := merge(defaults(kind), row)
			switch kind {
			case "users":
				d["_password"] = row["password"]
				delete(d, "password")
				if !strings.HasPrefix(str(d, "_password"), "pbkdf2_sha256$") && !strings.HasPrefix(str(d, "_password"), "!") {
					return nil, fmt.Errorf("user %s has unsupported legacy password hash", str(d, "username"))
				}
				sec := secs[num(row, "id")]
				d["_totp_secret"], e = decrypt(str(sec, "totp_secret_enc"))
				if e != nil {
					return nil, e
				}
				d["_totp_enabled"] = flag(sec, "totp_enabled")
				d["_recovery"] = array(sec, "recovery_codes_hash")
				d["_totp_step"] = int64(-1)
				d["_auth_version"] = 1
			case "nodes":
				d["_agent_token"], e = decrypt(str(row, "agent_token_enc"))
				delete(d, "agent_token_enc")
				if e != nil {
					return nil, e
				}
				if flag(d, "is_local") {
					d["agent_url"] = "http://127.0.0.1:9191"
				}
				d["deploy_state"] = "pending"
				d["status"] = "unknown"
			case "inbounds":
				d["node"] = row["node_id"]
				delete(d, "node_id")
			case "clients":
				d["inbound"] = row["inbound_id"]
				delete(d, "inbound_id")
				d["lifetime_traffic_bytes"] = num(row, "used_traffic_bytes")
			case "api_keys":
				d["user"] = row["user_id"]
				delete(d, "user_id")
				d["_token_hash"] = row["token_hash"]
				delete(d, "token_hash")
			case "audit":
				d["actor"] = row["actor_id"]
				delete(d, "actor_id")
				d["actor_name"] = "system"
				if num(d, "actor") > 0 {
					u, e := get(ctx, tx, "users", num(d, "actor"))
					if e == nil {
						d["actor_name"] = str(u, "username")
					}
				}
			}
			raw, e := json.Marshal(d)
			if e != nil {
				return nil, e
			}
			if _, e = tx.Exec(ctx, "INSERT INTO "+tables[kind]+"(id,data) VALUES($1,$2)", num(row, "id"), string(raw)); e != nil {
				return nil, e
			}
		}
		if _, e = tx.Exec(ctx, "SELECT setval(pg_get_serial_sequence('"+tables[kind]+"','id'),GREATEST(COALESCE((SELECT max(id) FROM "+tables[kind]+"),0),1),EXISTS(SELECT 1 FROM "+tables[kind]+"))"); e != nil {
			return nil, e
		}
	}
	cfgRows, e := legacyRows(ctx, tx, "core_appsetting")
	if e != nil {
		return nil, e
	}
	if len(cfgRows) > 0 {
		cfg := merge(defaultSettings(), cfgRows[0])
		for _, k := range []string{"id", "created_at", "updated_at"} {
			delete(cfg, k)
		}
		cfg["_telegram_token"], e = decrypt(str(cfg, "telegram_bot_token_enc"))
		if e != nil {
			return nil, e
		}
		cfg["_telegram_last_update_id"] = cfg["telegram_last_update_id"]
		cfg["_telegram_last_alerts"] = cfg["telegram_last_alerts"]
		for _, k := range []string{"telegram_bot_token_enc", "telegram_last_update_id", "telegram_last_alerts"} {
			delete(cfg, k)
		}
		if e = saveSettings(ctx, tx, cfg); e != nil {
			return nil, e
		}
	}
	// Legacy samples measured changing quota sums. Retain their table instead of importing misleading deltas.
	if !dryRun {
		if e = audit(ctx, tx, 0, "migration.import_legacy", "v0.1.0", count); e != nil {
			return nil, e
		}
		if e = tx.Commit(ctx); e != nil {
			return nil, e
		}
	}
	count["dry_run"] = dryRun
	return count, nil
}
func (s *Store) BootstrapLocal(ctx context.Context, c Config, host, token string) error {
	if !validHost(host) || len(token) < 32 {
		return errors.New("valid public host and agent token are required")
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(842100,2)`); e != nil {
		return e
	}
	ns, e := list(ctx, tx, "nodes", `WHERE data->>'is_local'='true'`)
	if e != nil {
		return e
	}
	n := defaults("nodes")
	if len(ns) > 0 {
		n = ns[0]
	}
	n["name"] = "Local Node"
	n["public_host"] = host
	n["agent_url"] = "http://127.0.0.1:9191"
	n["enabled"] = true
	n["is_local"] = true
	n["verify_tls"] = true
	n["_agent_token"], e = seal(c.FieldKey, token)
	if e != nil {
		return e
	}
	if e = save(ctx, tx, "nodes", n); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

var _ pgx.Tx
