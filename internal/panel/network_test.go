package panel

import (
	"fmt"
	"testing"
)

func TestIntegrationNetworkDefaultsOrderingAndCoreIsolation(t *testing.T) {
	s, ctx := integration(t)
	n, _, _ := fixture(t, s, ctx, &nodeMock{running: true})
	n["_singbox_deployed"] = true
	outbound := defaults("outbounds")
	outbound["node"], outbound["name"], outbound["tag"], outbound["protocol"] = num(n, "id"), "Edge", "edge", "socks"
	outbound["config"] = Data{"settings": Data{"servers": []any{Data{"address": "127.0.0.1", "port": 1080}}}}
	if err := validateNetworkEntity(ctx, s.Store.Pool, "outbounds", outbound); err != nil {
		t.Fatal(err)
	}
	if err := save(ctx, s.Store.Pool, "outbounds", outbound); err != nil {
		t.Fatal(err)
	}
	for _, priority := range []int64{200, 100} {
		rule := defaults("routing_rules")
		rule["node"], rule["name"], rule["priority"] = num(n, "id"), "route", priority
		rule["config"] = Data{"outboundTag": "edge", "domain": []any{fmt.Sprintf("domain:route-%d.example", priority)}, "port": "443"}
		if err := validateNetworkEntity(ctx, s.Store.Pool, "routing_rules", rule); err != nil {
			t.Fatal(err)
		}
		if err := save(ctx, s.Store.Pool, "routing_rules", rule); err != nil {
			t.Fatal(err)
		}
	}
	reject := defaults("routing_rules")
	reject["node"], reject["core"], reject["name"] = num(n, "id"), "singbox", "private"
	reject["config"] = Data{"action": "reject", "ip_is_private": true}
	if err := validateNetworkEntity(ctx, s.Store.Pool, "routing_rules", reject); err != nil {
		t.Fatal(err)
	}
	if err := save(ctx, s.Store.Pool, "routing_rules", reject); err != nil {
		t.Fatal(err)
	}
	cfg, err := buildConfig(ctx, s.Store.Pool, n)
	if err != nil {
		t.Fatal(err)
	}
	outs := array(cfg, "outbounds")
	if len(outs) != 3 || str(outs[0].(Data), "tag") != "direct" || str(outs[1].(Data), "tag") != "blocked" || str(outs[2].(Data), "tag") != "edge" {
		t.Fatal("default outbounds changed", outs)
	}
	rules := array(obj(cfg, "routing"), "rules")
	if len(rules) != 3 || str(rules[0].(Data), "outboundTag") != "api" || str(rules[1].(Data), "outboundTag") != "edge" || array(rules[1].(Data), "domain")[0] != "domain:route-100.example" {
		t.Fatal("protected API or routes missing", rules)
	}
	sing := obj(cfg, "_singbox")
	singRules := array(obj(sing, "route"), "rules")
	if len(array(sing, "outbounds")) != 1 || len(singRules) != 1 || str(singRules[0].(Data), "action") != "reject" || str(obj(sing, "route"), "final") != "direct" {
		t.Fatal("core routes leaked", sing)
	}
	protocolRule := defaults("routing_rules")
	protocolRule["node"], protocolRule["core"], protocolRule["name"] = num(n, "id"), "singbox", "bittorrent"
	protocolRule["config"] = Data{"action": "reject", "protocol": []any{"bittorrent"}}
	if err := save(ctx, s.Store.Pool, "routing_rules", protocolRule); err != nil {
		t.Fatal(err)
	}
	cfg, err = buildConfig(ctx, s.Store.Pool, n)
	if err != nil {
		t.Fatal(err)
	}
	singRules = array(obj(obj(cfg, "_singbox"), "route"), "rules")
	if len(singRules) != 3 || str(singRules[0].(Data), "action") != "sniff" {
		t.Fatal("protocol rule lacks sniffing", singRules)
	}

	outbound["enabled"] = false
	if err := save(ctx, s.Store.Pool, "outbounds", outbound); err != nil {
		t.Fatal(err)
	}
	if _, err = buildConfig(ctx, s.Store.Pool, n); err == nil {
		t.Fatal("routing to a disabled outbound was accepted")
	}
	reject["config"] = Data{"outbound": "blocked", "ip_is_private": true}
	if err = validateNetworkEntity(ctx, s.Store.Pool, "routing_rules", reject); err == nil {
		t.Fatal("sing-box accepted a nonexistent block outbound")
	}
}
