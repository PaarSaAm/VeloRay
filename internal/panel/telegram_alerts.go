package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (s *Server) telegramAlerts(ctx context.Context, cfg Data, token string) error {
	alerts := obj(cfg, "_telegram_last_alerts")
	cooldown := time.Duration(num(cfg, "telegram_alert_cooldown_minutes")) * time.Minute
	notices := map[string]string{}
	metrics := hostMetrics()
	for metric, field := range map[string]string{"cpu_percent": "telegram_alert_cpu_percent", "memory_percent": "telegram_alert_memory_percent", "disk_percent": "telegram_alert_disk_percent"} {
		value, _ := metrics[metric].(float64)
		if value >= float64(num(cfg, field)) {
			notices[metric] = fmt.Sprintf("%s %.1f%%", strings.TrimSuffix(metric, "_percent"), value)
		}
	}
	nodes, e := list(ctx, s.Store.Pool, "nodes", "ORDER BY id")
	if e != nil {
		return e
	}
	for _, n := range nodes {
		key := fmt.Sprintf("node:%d", num(n, "id"))
		if !flag(n, "enabled") {
			continue
		}
		if oneOf(str(n, "status"), "offline", "degraded") {
			notices[key] = str(n, "name") + ": " + str(n, "status")
		} else if str(n, "status") == "ok" && str(alerts, key) != "" {
			notices[key+":recovered"] = str(n, "name") + ": recovered"
		}
	}
	if flag(cfg, "telegram_client_alerts") {
		clients, e := list(ctx, s.Store.Pool, "clients", "ORDER BY id")
		if e != nil {
			return e
		}
		seen := map[string]bool{}
		for _, c := range clients {
			i, e := get(ctx, s.Store.Pool, "inbounds", num(c, "inbound"))
			if e != nil {
				return e
			}
			if !flag(i, "enabled") {
				continue
			}
			key := accountKey(c)
			if seen[key] {
				continue
			}
			seen[key] = true
			if num(c, "traffic_limit_bytes") > 0 && float64(num(c, "used_traffic_bytes"))/float64(num(c, "traffic_limit_bytes"))*100 >= float64(num(cfg, "telegram_quota_warning_percent")) {
				category := "quota-warning"
				if num(c, "used_traffic_bytes") >= num(c, "traffic_limit_bytes") {
					category = "quota-exhausted"
				}
				notices[key+":"+category] = fmt.Sprintf("%s: %s / %s billed", str(c, "name"), fmtBytes(num(c, "used_traffic_bytes")), quotaText(c))
			}
			if exp, e := timestamp(c, "expires_at"); e == nil && time.Until(exp) <= time.Duration(num(cfg, "telegram_expiry_warning_days"))*24*time.Hour {
				category := "expiry-warning"
				if !exp.After(time.Now()) {
					category = "expired"
				}
				notices[key+":"+category+":"+exp.Format("2006-01-02")] = str(c, "name") + ": " + category + " · " + exp.Format(time.RFC3339)
			}
		}
	}
	lines := []string{}
	sentKeys := []string{}
	for key, message := range notices {
		last, _ := time.Parse(time.RFC3339Nano, str(alerts, key))
		if time.Since(last) < cooldown {
			continue
		}
		if len(lines) >= 10 {
			break
		}
		lines = append(lines, message)
		sentKeys = append(sentKeys, key)
	}
	if len(lines) == 0 {
		return nil
	}
	for owner := range telegramOwners(cfg) {
		if _, e = s.telegramRequest(ctx, token, "sendMessage", Data{"chat_id": owner, "text": "VeloRay alerts\n" + strings.Join(lines, "\n"), "disable_web_page_preview": true, "reply_markup": botHome(cfg)}); e != nil {
			return e
		}
	}
	for _, key := range sentKeys {
		alerts[key] = stamp()
		if strings.HasSuffix(key, ":recovered") {
			delete(alerts, strings.TrimSuffix(key, ":recovered"))
		}
	}
	// Expired client alert keys are bounded so removed clients do not grow settings forever.
	for key, value := range alerts {
		if t, e := time.Parse(time.RFC3339Nano, fmt.Sprint(value)); e != nil || time.Since(t) > 7*24*time.Hour {
			delete(alerts, key)
		}
	}
	b, _ := json.Marshal(alerts)
	_, e = s.Store.Pool.Exec(ctx, `UPDATE vr_settings SET data=jsonb_set(data,'{_telegram_last_alerts}',$1::jsonb) WHERE id=1`, string(b))
	return e
}
