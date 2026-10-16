package panel

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestWebhookURLRejectsInternalNetworks(t *testing.T) {
	for _, bad := range []string{
		"http://example.com/hook",
		"https://localhost/hook",
		"https://127.0.0.1/hook",
		"https://10.2.3.4/hook",
		"https://192.168.1.1/hook",
		"https://169.254.169.254/metadata",
		"https://100.64.1.1/hook",
		"https://[::1]/hook",
		"https://[fc00::1]/hook",
		"https://admin:password@example.com/hook",
		"https://example.com/hook#fragment",
		"https://example.local/hook",
	} {
		if err := validateWebhookURL(bad); err == nil {
			t.Errorf("unsafe webhook URL accepted: %s", bad)
		}
	}
	for _, good := range []string{
		"https://example.com/hook",
		"https://example.com:8443/events?kind=client",
		"https://1.1.1.1/hook",
		"",
	} {
		if err := validateWebhookURL(good); err != nil {
			t.Errorf("expected valid URL %q: %v", good, err)
		}
	}
}

func TestWebhookHMACAndRetryBackoff(t *testing.T) {
	secret, timestamp, payload := "top-secret-test-key", "1700000000", []byte(`{"event":"clients.create","id":42}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(append([]byte(timestamp+"."), payload...))
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if got := webhookSignature(secret, timestamp, payload); got != want {
		t.Fatalf("signature mismatch: %q != %q", got, want)
	}
	if webhookSignature(secret, timestamp, []byte("tampered")) == want {
		t.Fatal("tampering did not change webhook signature")
	}
	for n, expect := range map[int]time.Duration{
		1: 15 * time.Second, 2: 30 * time.Second, 3: time.Minute,
		4: 2 * time.Minute, 8: 1920 * time.Second, 100: 1920 * time.Second,
	} {
		if got := webhookBackoff(n); got != expect {
			t.Fatalf("unexpected retry delay for attempt %d: %s", n, got)
		}
	}
}

func TestIntegrationWebhookAuditOutboxCommitAndRollback(t *testing.T) {
	s, ctx := integration(t)
	d, err := settings(ctx, s.Store.Pool)
	if err != nil {
		t.Fatal(err)
	}
	d["webhook_url"] = "https://hooks.example.com/veloray"
	d["webhook_enabled"] = true
	key := strings.Repeat("K", 48)
	d["_webhook_secret"], err = seal(s.Config.FieldKey, key)
	if err != nil {
		t.Fatal(err)
	}
	if err = saveSettings(ctx, s.Store.Pool, d); err != nil {
		t.Fatal(err)
	}
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = audit(ctx, tx, 0, "clients.create", "clients", Data{"token": "never-send-this"}); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.Store.Pool.QueryRow(ctx, "SELECT count(*) FROM vr_webhook_deliveries").Scan(&count); err != nil || count != 0 {
		t.Fatalf("rolled back audit queued an event: count=%d error=%v", count, err)
	}
	if err = audit(ctx, s.Store.Pool, 0, "clients.create", "clients", Data{"token": "never-send-this"}); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err = s.Store.Pool.QueryRow(ctx, "SELECT payload FROM vr_webhook_deliveries ORDER BY id DESC LIMIT 1").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var item Data
	if err = json.Unmarshal(raw, &item); err != nil {
		t.Fatal(err)
	}
	if item["event"] != "clients.create" || item["target"] != "clients" {
		t.Fatalf("unexpected payload: %+v", item)
	}
	if strings.Contains(string(raw), "never-send-this") || strings.Contains(string(raw), key) || strings.Contains(string(raw), "token") {
		t.Fatalf("sensitive fields leaked in webhook: %s", raw)
	}

	// Disabling delivery also stops future event enqueueing.
	d["webhook_enabled"] = false
	if err = saveSettings(ctx, s.Store.Pool, d); err != nil {
		t.Fatal(err)
	}
	if err = audit(ctx, s.Store.Pool, 0, "clients.delete", "clients", Data{}); err != nil {
		t.Fatal(err)
	}
	if err = s.Store.Pool.QueryRow(ctx, "SELECT count(*) FROM vr_webhook_deliveries").Scan(&count); err != nil || count != 1 {
		t.Fatalf("disabled webhook was queued: count=%d error=%v", count, err)
	}
}

func TestWebhookContextCancellation(t *testing.T) {
	s, ctx := integration(t)
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	if err := s.deliverWebhookQueue(ctx); err == nil {
		// PostgreSQL may reject the canceled request before settings are read;
		// a no-op response is safe when webhooks are disabled.
		return
	} else if err != context.Canceled {
		t.Fatalf("unexpected cancellation failure: %v", err)
	}
}
