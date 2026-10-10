package panel

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type telegramTransport struct {
	updates          []any
	sent             []Data
	failSend         bool
	acknowledgements int
}

func (m *telegramTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	raw, _ := io.ReadAll(r.Body)
	body, _ := decode(raw)
	result := Data{"ok": true, "result": true}
	switch {
	case strings.HasSuffix(r.URL.Path, "/getUpdates"):
		result["result"] = m.updates
	case strings.HasSuffix(r.URL.Path, "/sendMessage"):
		if m.failSend {
			m.failSend = false
			return nil, fmt.Errorf("simulated Telegram failure")
		}
		m.sent = append(m.sent, body)
	case strings.HasSuffix(r.URL.Path, "/answerCallbackQuery"):
		m.acknowledgements++
	case strings.HasSuffix(r.URL.Path, "/getMe"):
		result["result"] = Data{"username": "testbot"}
	case strings.HasSuffix(r.URL.Path, "/getWebhookInfo"):
		result["result"] = Data{"url": ""}
	}
	b, _ := json.Marshal(result)
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(b))), Header: http.Header{}}, nil
}

func TestTelegramOwnerAndPrivateChatChecks(t *testing.T) {
	cfg := defaultSettings()
	cfg["telegram_owner_ids"] = []any{"123"}
	from := Data{"id": 123}
	m := Data{"chat": Data{"id": 123, "type": "private"}}
	if !telegramPermitted(cfg, m, from) {
		t.Fatal("owner rejected")
	}
	for _, bad := range []Data{{"chat": Data{"id": 123, "type": "group"}}, {"chat": Data{"id": 321, "type": "private"}}} {
		if telegramPermitted(cfg, bad, from) {
			t.Fatal("non-private owner chat permitted")
		}
	}
	if telegramPermitted(cfg, m, Data{"id": 321}) {
		t.Fatal("outsider permitted")
	}
}

func TestIntegrationTelegramConfirmationOwnerReplayAnd2FA(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true}
	_, _, c := fixture(t, s, ctx, m)
	cfg := defaultSettings()
	cfg["telegram_allow_changes"] = true
	reply := s.telegramConfirm(ctx, cfg, "123", "clients", num(c, "id"), "disable")
	rows, _ := obj(reply, "reply_markup")["inline_keyboard"].([][]any)
	if len(rows) == 0 {
		t.Fatal("missing confirmation buttons")
	}
	nonce := strings.TrimPrefix(str(asData(rows[0][0]), "callback_data"), "vr:/confirm ")
	s.telegramExecute(ctx, cfg, "321", nonce)
	fresh, _ := get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if !flag(fresh, "enabled") || m.applies != 0 {
		t.Fatal("other owner used confirmation")
	}
	cfg["require_2fa_for_admins"] = true
	s.telegramExecute(ctx, cfg, "123", nonce)
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if !flag(fresh, "enabled") {
		t.Fatal("bot bypassed required 2FA")
	}
	cfg["require_2fa_for_admins"] = false
	s.telegramExecute(ctx, cfg, "123", nonce)
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if flag(fresh, "enabled") || m.applies != 1 {
		t.Fatal("confirmed disable not applied")
	}
	s.telegramExecute(ctx, cfg, "123", nonce)
	if m.applies != 1 {
		t.Fatal("confirmation replay reapplied mutation")
	}
	reply = s.telegramConfirm(ctx, cfg, "123", "clients", num(c, "id"), "enable")
	rows, _ = obj(reply, "reply_markup")["inline_keyboard"].([][]any)
	nonce = strings.TrimPrefix(str(asData(rows[0][0]), "callback_data"), "vr:/confirm ")
	s.telegramReply(ctx, cfg, "/cancel "+nonce, "123")
	s.telegramExecute(ctx, cfg, "123", nonce)
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if flag(fresh, "enabled") || m.applies != 1 {
		t.Fatal("cancelled confirmation remained usable")
	}
}

func TestIntegrationTelegramRepliesRetryWithoutRepeatingChanges(t *testing.T) {
	s, ctx := integration(t)
	cfg := defaultSettings()
	cfg["telegram_enabled"] = true
	cfg["telegram_owner_ids"] = []any{"123"}
	token, e := seal(s.Config.FieldKey, "12345:fake_token_for_tests")
	if e != nil {
		t.Fatal(e)
	}
	cfg["_telegram_token"] = token
	update := Data{"update_id": 10, "message": Data{"from": Data{"id": 123}, "chat": Data{"id": 123, "type": "private"}, "text": "/status"}}
	transport := &telegramTransport{updates: []any{update}, failSend: true}
	s.TelegramHTTP = &http.Client{Transport: transport}
	if e = saveSettings(ctx, s.Store.Pool, cfg); e != nil {
		t.Fatal(e)
	}
	if e = s.telegram(ctx, cfg); e == nil {
		t.Fatal("failed delivery reported success")
	}
	if e = s.telegram(ctx, cfg); e != nil {
		t.Fatal(e)
	}
	if len(transport.sent) != 1 {
		t.Fatal("missing retried reply")
	}
	if e = s.telegram(ctx, cfg); e != nil {
		t.Fatal(e)
	}
	if len(transport.sent) != 1 {
		t.Fatal("duplicate update sent twice")
	}
	transport.updates = []any{Data{"update_id": 11, "callback_query": Data{"id": "callback-test", "from": Data{"id": 123}, "message": Data{"chat": Data{"id": 123, "type": "private"}}, "data": "vr:/clients 1"}}}
	if e = s.telegram(ctx, cfg); e != nil || transport.acknowledgements != 1 {
		t.Fatal("callback query not acknowledged", e)
	}
	transport.updates = []any{Data{"update_id": 12, "message": Data{"from": Data{"id": 999}, "chat": Data{"id": 999, "type": "private"}, "text": "/status"}}}
	if e = s.telegram(ctx, cfg); e != nil {
		t.Fatal(e)
	}
	if len(transport.sent) != 2 {
		t.Fatal("bot replied to an unauthorized sender")
	}
	var payload string
	_ = s.Store.Pool.QueryRow(ctx, `SELECT data::text FROM vr_settings WHERE id=1`).Scan(&payload)
	if strings.Contains(payload, "fake_token_for_tests") {
		t.Fatal("bot token stored unencrypted")
	}
}

func TestIntegrationMultiplierChangesOnlyFutureTraffic(t *testing.T) {
	s, ctx := integration(t)
	m := &nodeMock{running: true, value: 5}
	n, _, c := fixture(t, s, ctx, m)
	req := httptest.NewRequest("PATCH", "/", strings.NewReader(`{"traffic_multiplier":3}`)).WithContext(ctx)
	if _, _, e := s.api(httptest.NewRecorder(), req, fmt.Sprintf("clients/%d", num(c, "id")), Actor{}); e != nil {
		t.Fatal(e)
	}
	m.value = 9
	if e := s.reconcileNode(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	fresh, e := get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if e != nil || num(fresh, "used_traffic_bytes") != 17 || num(fresh, "raw_used_traffic_bytes") != 9 {
		t.Fatal("existing usage was re-priced", e)
	}
	if e = s.reconcileNode(ctx, num(n, "id")); e != nil {
		t.Fatal(e)
	}
	fresh, _ = get(ctx, s.Store.Pool, "clients", num(c, "id"))
	if num(fresh, "used_traffic_bytes") != 17 {
		t.Fatal("unchanged counter counted twice")
	}
	req = httptest.NewRequest("PATCH", "/", strings.NewReader(`{"traffic_multiplier":3.001}`)).WithContext(ctx)
	if _, _, e = s.api(httptest.NewRecorder(), req, fmt.Sprintf("clients/%d", num(c, "id")), Actor{}); e == nil {
		t.Fatal("API accepted multiplier above three")
	}
}
