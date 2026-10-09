package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

type fakeRuntime struct {
	mu                  sync.Mutex
	value               int64
	epoch               int
	running             bool
	reject, restartFail bool
	restarts            int
}

func (f *fakeRuntime) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if name == "xray" {
		switch args[0] {
		case "version":
			return []byte("Xray 26.10.1"), nil
		case "api":
			b, _ := json.Marshal(map[string]any{"stat": []Counter{{"user>>>veloray:1:alice>>>traffic>>>uplink", f.value}}})
			return b, nil
		case "run":
			if f.reject {
				return []byte("invalid settings"), errors.New("reject")
			}
			return nil, nil
		}
	}
	if name == "systemctl" {
		switch args[0] {
		case "show":
			if !f.running {
				return []byte("MainPID=0"), nil
			}
			return []byte(fmt.Sprintf("MainPID=123\nExecMainStartTimestampMonotonic=%d", f.epoch)), nil
		case "is-active":
			if f.running {
				return []byte("active"), nil
			}
			return []byte("inactive"), errors.New("inactive")
		case "restart":
			f.restarts++
			if f.restartFail {
				f.restartFail = false
				return []byte("failed"), errors.New("restart")
			}
			f.epoch++
			f.value = 0
			f.running = true
			return nil, nil
		case "stop":
			f.running = false
			return nil, nil
		}
	}
	return nil, nil
}
func testManager(t *testing.T) (*Manager, *fakeRuntime) {
	t.Helper()
	d := t.TempDir()
	f := &fakeRuntime{running: true, epoch: 1}
	m, e := NewManager("xray", filepath.Join(d, "config.json"), "xray", filepath.Join(d, "state.json"), f)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(m.ConfigPath, []byte(`{"old":true}`), 0600); e != nil {
		t.Fatal(e)
	}
	return m, f
}
func TestDurableAccountingAcrossRestartAndAgentReload(t *testing.T) {
	m, f := testManager(t)
	ctx := context.Background()
	f.value = 100
	s, e := m.Stats(ctx)
	if e != nil || s.Stat[0].Value != 100 {
		t.Fatal(s, e)
	}
	s, _ = m.Stats(ctx)
	if s.Stat[0].Value != 100 {
		t.Fatal("double count")
	}
	if e = m.Restart(ctx); e != nil {
		t.Fatal(e)
	}
	f.value = 25
	s, e = m.Stats(ctx)
	if e != nil || s.Stat[0].Value != 125 {
		t.Fatal(s, e)
	}
	m2, e := NewManager("xray", m.ConfigPath, "xray", m.StatePath, f)
	if e != nil {
		t.Fatal(e)
	}
	s, e = m2.Stats(ctx)
	if e != nil || s.Stat[0].Value != 125 {
		t.Fatal(s, e)
	}
	f.value = 5
	s, _ = m2.Stats(ctx)
	if s.Stat[0].Value != 130 {
		t.Fatal("external reset lost traffic", s)
	}
}
func TestApplyJournalIdempotencyAndActualRollback(t *testing.T) {
	m, f := testManager(t)
	ctx := context.Background()
	id := "operation-123456789"
	cfg := []byte(`{"new":true}`)
	if e := m.Apply(ctx, id, cfg); e != nil {
		t.Fatal(e)
	}
	if e := m.Apply(ctx, id, cfg); e != nil || f.restarts != 1 {
		t.Fatal(e, f.restarts)
	}
	if e := m.Rollback(ctx, id); e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(m.ConfigPath)
	if string(raw) != `{"old":true}` {
		t.Fatal(string(raw))
	}
	if e := m.Rollback(ctx, id); e != nil {
		t.Fatal(e)
	}
}
func TestApplyFailureRestoresPriorConfig(t *testing.T) {
	m, f := testManager(t)
	f.value = 100
	f.restartFail = true
	if e := m.Apply(context.Background(), "failure-operation-123", []byte(`{"new":true}`)); e == nil {
		t.Fatal("expected failure")
	}
	raw, _ := os.ReadFile(m.ConfigPath)
	if string(raw) != `{"old":true}` {
		t.Fatal(string(raw))
	}
	s, e := m.Stats(context.Background())
	if e != nil || s.Stat[0].Value != 100 {
		t.Fatal(s, e)
	}
}
func TestRollbackRefusesSupersededConfig(t *testing.T) {
	m, _ := testManager(t)
	ctx := context.Background()
	if e := m.Apply(ctx, "operation-first-12345", []byte(`{"a":1}`)); e != nil {
		t.Fatal(e)
	}
	if e := m.Apply(ctx, "operation-second-1234", []byte(`{"a":2}`)); e != nil {
		t.Fatal(e)
	}
	if e := m.Rollback(ctx, "operation-first-12345"); e == nil {
		t.Fatal("rollback clobbered later update")
	}
}
func TestConcurrentStatsAreSerialized(t *testing.T) {
	m, f := testManager(t)
	f.value = 100
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, e := m.Stats(context.Background())
			if e != nil || s.Stat[0].Value != 100 {
				t.Error(s, e)
			}
		}()
	}
	wg.Wait()
}
func TestCorruptLedgerFailsClosed(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "state.json")
	_ = os.WriteFile(p, []byte("invalid"), 0600)
	if _, e := NewManager("xray", filepath.Join(d, "config"), "xray", p, nil); e == nil {
		t.Fatal("corrupt ledger accepted")
	}
}
