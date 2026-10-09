package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"time"
)

func (s *Server) telegramRequest(ctx context.Context, token, method string, in any) (Data, error) {
	b, e := json.Marshal(in)
	if e != nil {
		return nil, e
	}
	req, e := http.NewRequestWithContext(ctx, "POST", "https://api.telegram.org/bot"+token+"/"+method, bytes.NewReader(b))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Do(req)
	if e != nil {
		return nil, errors.New("Telegram connection failed")
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if e != nil {
		return nil, e
	}
	v, e := decode(raw)
	if e != nil || res.StatusCode != 200 || !flag(v, "ok") {
		return nil, errors.New("Telegram request failed")
	}
	return v, nil
}
func (s *Server) telegram(ctx context.Context, cfg Data) error {
	token, e := unseal(s.Config.FieldKey, str(cfg, "_telegram_token"))
	if e != nil || token == "" {
		return errors.New("bot token is missing")
	}
	owners := map[string]bool{}
	for _, o := range array(cfg, "telegram_owner_ids") {
		if id, ok := o.(string); ok {
			owners[id] = true
		}
	}
	updates, e := s.telegramRequest(ctx, token, "getUpdates", Data{"offset": num(cfg, "_telegram_last_update_id") + 1, "limit": 20, "timeout": 0, "allowed_updates": []any{"message"}})
	if e != nil {
		return e
	}
	for _, raw := range array(updates, "result") {
		b, _ := json.Marshal(raw)
		u, e := decode(b)
		if e != nil {
			return e
		}
		id := num(u, "update_id")
		m := obj(u, "message")
		chat, from := obj(m, "chat"), obj(m, "from")
		sender := strconv.FormatInt(num(from, "id"), 10)
		permitted := owners[sender] && str(chat, "type") == "private" && num(chat, "id") == num(from, "id")
		var done bool
		_ = s.Store.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vr_telegram_updates WHERE id=$1)`, id).Scan(&done)
		if !done && permitted {
			text := s.telegramCommand(ctx, cfg, str(m, "text"), sender)
			if _, e = s.telegramRequest(ctx, token, "sendMessage", Data{"chat_id": num(chat, "id"), "text": text, "disable_web_page_preview": true}); e != nil {
				return e
			}
		}
		tx, e := s.Store.Pool.Begin(ctx)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO vr_telegram_updates(id) VALUES($1) ON CONFLICT DO NOTHING`, id)
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE vr_settings SET data=jsonb_set(data,'{_telegram_last_update_id}',to_jsonb(GREATEST(COALESCE((data->>'_telegram_last_update_id')::bigint,0),$1::bigint))) WHERE id=1`, id)
		}
		if e != nil {
			_ = tx.Rollback(ctx)
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
	}
	metrics := hostMetrics()
	alerts := obj(cfg, "_telegram_last_alerts")
	for metric, field := range map[string]string{"cpu_percent": "telegram_alert_cpu_percent", "memory_percent": "telegram_alert_memory_percent", "disk_percent": "telegram_alert_disk_percent"} {
		value, _ := metrics[metric].(float64)
		if value < float64(num(cfg, field)) {
			continue
		}
		last, _ := time.Parse(time.RFC3339Nano, str(alerts, metric))
		if time.Since(last) < time.Duration(num(cfg, "telegram_alert_cooldown_minutes"))*time.Minute {
			continue
		}
		for owner := range owners {
			if _, e = s.telegramRequest(ctx, token, "sendMessage", Data{"chat_id": owner, "text": fmt.Sprintf("VeloRay: %s is %.1f%%", strings.TrimSuffix(metric, "_percent"), value)}); e != nil {
				return e
			}
		}
		alerts[metric] = stamp()
	}
	b, _ := json.Marshal(alerts)
	_, e = s.Store.Pool.Exec(ctx, `UPDATE vr_settings SET data=jsonb_set(data,'{_telegram_last_alerts}',$1::jsonb) WHERE id=1`, string(b))
	return e
}
func (s *Server) telegramCommand(ctx context.Context, cfg Data, text, owner string) string {
	p := strings.Fields(text)
	if len(p) == 0 {
		return "Use /help"
	}
	cmd := strings.ToLower(strings.Split(p[0], "@")[0])
	if cmd == "/client" || cmd == "/node" {
		if flag(cfg, "require_2fa_for_admins") {
			return "Use the panel for changes when two-factor authentication is required"
		}
		if len(p) != 3 {
			return "Use /client ID enable|disable or /node ID deploy|restart"
		}
		id, e := strconv.ParseInt(p[1], 10, 64)
		if e != nil || id < 1 {
			return "Invalid ID"
		}
		kind, action := "clients", "toggle"
		if cmd == "/node" {
			kind = "nodes"
			action = map[string]string{"deploy": "deploy", "restart": "xray-restart"}[p[2]]
			if action == "" {
				return "Use deploy or restart"
			}
		} else {
			if p[2] != "enable" && p[2] != "disable" {
				return "Use enable or disable"
			}
			c, e := get(ctx, s.Store.Pool, "clients", id)
			if e != nil {
				return "Client not found"
			}
			if flag(c, "enabled") == (p[2] == "enable") {
				return "Already " + p[2] + "d"
			}
		}
		req := httptest.NewRequest("POST", "/", strings.NewReader("{}"))
		req = req.WithContext(ctx)
		_, _, e = s.action(httptest.NewRecorder(), req, kind, id, action, Actor{})
		_ = audit(ctx, s.Store.Pool, 0, "telegram.command", owner, Data{"command": cmd, "id": id})
		if e != nil {
			return "Change failed. Check the panel's node status"
		}
		return "Done"
	}
	switch cmd {
	case "/start", "/help":
		return "VeloRay\n/status · /nodes · /clients\n/client ID enable|disable · /node ID deploy|restart"
	case "/status":
		o, e := s.overview(ctx)
		if e != nil {
			return "Status is unavailable"
		}
		return fmt.Sprintf("Nodes: %d/%d healthy\nClients: %d/%d active\nTraffic: %s", num(o, "nodes_online"), num(o, "nodes_total"), num(o, "clients_active"), num(o, "clients_total"), fmtBytes(num(o, "traffic_used_bytes")))
	case "/nodes":
		ns, e := list(ctx, s.Store.Pool, "nodes", "ORDER BY id LIMIT 30")
		if e != nil {
			return "Nodes are unavailable"
		}
		rows := []string{}
		for _, n := range ns {
			rows = append(rows, fmt.Sprintf("%d · %s · %s", num(n, "id"), str(n, "name"), str(n, "status")))
		}
		return fallback(strings.Join(rows, "\n"), "No nodes")
	case "/clients":
		cs, e := list(ctx, s.Store.Pool, "clients", "ORDER BY id LIMIT 30")
		if e != nil {
			return "Clients are unavailable"
		}
		rows := []string{}
		for _, c := range cs {
			rows = append(rows, fmt.Sprintf("%d · %s · %s", num(c, "id"), str(c, "name"), fmtBytes(num(c, "used_traffic_bytes"))))
		}
		return fallback(strings.Join(rows, "\n"), "No clients")
	}
	return "Use the panel to change clients or restart nodes. /help lists supported commands."
}
