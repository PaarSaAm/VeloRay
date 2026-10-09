package agent

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Runtime interface {
	Run(context.Context, string, ...string) ([]byte, error)
}
type Commands struct{}

func (Commands) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type Status struct {
	Installed bool   `json:"installed"`
	Running   bool   `json:"running"`
	Version   string `json:"version"`
}
type Counter struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}
type Snapshot struct {
	Stat       []Counter `json:"stat"`
	Accounting string    `json:"accounting"`
	LedgerID   string    `json:"ledger_id"`
}
type counterState struct {
	Raw   int64  `json:"raw"`
	Total int64  `json:"total"`
	Epoch string `json:"epoch"`
}
type operation struct {
	Before []byte    `json:"before"`
	After  string    `json:"after"`
	State  string    `json:"state"`
	At     time.Time `json:"at"`
}
type ledger struct {
	ID         string                  `json:"id"`
	Counters   map[string]counterState `json:"counters"`
	Operations map[string]operation    `json:"operations"`
}
type Manager struct {
	Binary, ConfigPath, ServiceName, StatePath string
	Runtime                                    Runtime
	mu                                         sync.Mutex
	state                                      ledger
}

func NewManager(binary, config, service, state string, run Runtime) (*Manager, error) {
	if run == nil {
		run = Commands{}
	}
	m := &Manager{Binary: binary, ConfigPath: config, ServiceName: service, StatePath: state, Runtime: run}
	raw, err := os.ReadFile(state)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(raw, &m.state); err != nil {
			return nil, fmt.Errorf("accounting state is corrupt: %w", err)
		}
	} else {
		b := make([]byte, 16)
		if _, err = rand.Read(b); err != nil {
			return nil, err
		}
		m.state.ID = hex.EncodeToString(b)
	}
	if m.state.ID == "" {
		return nil, errors.New("missing accounting ledger identity")
	}
	if m.state.Counters == nil {
		m.state.Counters = map[string]counterState{}
	}
	if m.state.Operations == nil {
		m.state.Operations = map[string]operation{}
	}
	if err = m.persist(); err != nil {
		return nil, err
	}
	return m, nil
}
func atomicWrite(path string, raw []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".veloray-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func (m *Manager) persist() error {
	b, err := json.Marshal(m.state)
	if err != nil {
		return err
	}
	return atomicWrite(m.StatePath, b, 0600)
}
func (m *Manager) status(ctx context.Context) Status {
	v, _ := m.Runtime.Run(ctx, m.Binary, "version")
	fields := strings.Fields(string(v))
	version := ""
	if len(fields) >= 2 {
		version = strings.Join(fields[:2], " ")
	}
	a, e := m.Runtime.Run(ctx, "systemctl", "is-active", m.ServiceName)
	return Status{version != "", e == nil && strings.TrimSpace(string(a)) == "active", version}
}
func (m *Manager) Status(ctx context.Context) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status(ctx)
}
func (m *Manager) epoch(ctx context.Context) (string, error) {
	b, e := m.Runtime.Run(ctx, "systemctl", "show", m.ServiceName, "--property=MainPID,ExecMainStartTimestampMonotonic")
	if e != nil {
		return "", e
	}
	s := strings.TrimSpace(string(b))
	if s == "" || strings.Contains(s, "MainPID=0\n") || strings.HasSuffix(s, "MainPID=0") {
		return "", errors.New("Xray is not running")
	}
	return s, nil
}
func (m *Manager) observe(ctx context.Context) error {
	epoch, err := m.epoch(ctx)
	if err != nil {
		return err
	}
	b, err := m.Runtime.Run(ctx, m.Binary, "api", "statsquery", "--server=127.0.0.1:10085")
	if err != nil {
		b, err = m.Runtime.Run(ctx, m.Binary, "api", "statsquery", "--server=127.0.1.0:10085")
	} // Upgrade bridge for v0.1.0 loopback configuration.
	if err != nil {
		return fmt.Errorf("Xray stats unavailable: %w", err)
	}
	var v struct {
		Stat []Counter `json:"stat"`
	}
	if err = json.Unmarshal(b, &v); err != nil {
		return fmt.Errorf("invalid Xray stats: %w", err)
	}
	old := m.state.Counters
	next := make(map[string]counterState, len(old))
	for k, v := range old {
		next[k] = v
	}
	for _, s := range v.Stat {
		if s.Value < 0 {
			return errors.New("negative Xray counter")
		}
		prev := next[s.Name]
		delta := s.Value
		if prev.Epoch == epoch && s.Value >= prev.Raw {
			delta = s.Value - prev.Raw
		}
		if delta > 0 && prev.Total > int64(^uint64(0)>>1)-delta {
			return errors.New("traffic counter overflow")
		}
		next[s.Name] = counterState{s.Value, prev.Total + delta, epoch}
	}
	m.state.Counters = next
	if err = m.persist(); err != nil {
		m.state.Counters = old
		return err
	}
	return nil
}
func (m *Manager) Stats(ctx context.Context) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status(ctx).Running {
		if err := m.observe(ctx); err != nil {
			return Snapshot{}, err
		}
	}
	s := Snapshot{Accounting: "durable-v1", LedgerID: m.state.ID, Stat: []Counter{}}
	for k, v := range m.state.Counters {
		s.Stat = append(s.Stat, Counter{k, v.Total})
	}
	return s, nil
}
func (m *Manager) Validate(ctx context.Context, raw []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.validate(ctx, raw)
}
func (m *Manager) validate(ctx context.Context, raw []byte) error {
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return errors.New("config must be a JSON object")
	}
	if err := os.MkdirAll(filepath.Dir(m.ConfigPath), 0700); err != nil {
		return err
	}
	f, e := os.CreateTemp(filepath.Dir(m.ConfigPath), ".validate-*.json")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(raw)
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	out, e := m.Runtime.Run(ctx, m.Binary, "run", "-test", "-config", f.Name())
	if e != nil {
		return fmt.Errorf("Xray rejected config: %.2000s", out)
	}
	return nil
}
func hash(raw []byte) string { v := sha256.Sum256(raw); return hex.EncodeToString(v[:]) }
func (m *Manager) restart(ctx context.Context) error {
	if _, real := m.Runtime.(Commands); real && os.Geteuid() == 0 {
		if group, e := user.LookupGroup("nogroup"); e == nil {
			gid, _ := strconv.Atoi(group.Gid)
			if e = os.Chown(m.ConfigPath, 0, gid); e != nil {
				return e
			}
		}
	}

	out, e := m.Runtime.Run(ctx, "systemctl", "restart", m.ServiceName)
	if e != nil {
		return fmt.Errorf("Xray restart failed: %.2000s", out)
	}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if m.status(ctx).Running {
			if e := m.observe(ctx); e == nil {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return errors.New("Xray did not become active")
}
func (m *Manager) Apply(ctx context.Context, id string, raw []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(id) < 16 || len(id) > 128 {
		return errors.New("operation_id must be 16–128 characters")
	}
	prior, known := m.state.Operations[id]
	if known {
		if prior.After != hash(raw) {
			return errors.New("operation_id reused with another config")
		}
		if prior.State == "rolled_back" || prior.State == "rollback_failed" {
			return errors.New("operation has already been rolled back")
		}
		if prior.State == "applied" {
			current, e := os.ReadFile(m.ConfigPath)
			if e == nil && hash(current) == prior.After {
				return nil
			}
			return errors.New("operation superseded by another config")
		}
	}
	if err := m.validate(ctx, raw); err != nil {
		return err
	}
	// A running runtime must be observed before any restart. Failing closed avoids losing quota data.
	if m.status(ctx).Running {
		if e := m.observe(ctx); e != nil {
			return e
		}
	}
	before, e := os.ReadFile(m.ConfigPath)
	if e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if known {
		if hash(before) != prior.After && hash(before) != hash(prior.Before) {
			return errors.New("prepared operation was superseded")
		}
		before = prior.Before
	}
	op := operation{Before: before, After: hash(raw), State: "prepared", At: time.Now().UTC()}
	for key, item := range m.state.Operations {
		if time.Since(item.At) > 7*24*time.Hour && oneTerminal(item.State) {
			delete(m.state.Operations, key)
		}
	}
	m.state.Operations[id] = op
	if e = m.persist(); e != nil {
		return e
	}
	if e = atomicWrite(m.ConfigPath, raw, 0640); e == nil {
		e = m.restart(ctx)
	}
	if e != nil {
		rollbackErr := m.restore(ctx, before)
		op.State = "rolled_back"
		if rollbackErr != nil {
			op.State = "rollback_failed"
		}
		m.state.Operations[id] = op
		saveErr := m.persist()
		return errors.Join(e, rollbackErr, saveErr)
	}
	op.State = "applied"
	m.state.Operations[id] = op
	return m.persist()
}
func (m *Manager) restore(ctx context.Context, b []byte) error {
	if len(b) == 0 {
		if e := os.Remove(m.ConfigPath); e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
		_, e := m.Runtime.Run(ctx, "systemctl", "stop", m.ServiceName)
		return e
	}
	if e := atomicWrite(m.ConfigPath, b, 0640); e != nil {
		return e
	}
	return m.restart(ctx)
}
func (m *Manager) Rollback(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	op, ok := m.state.Operations[id]
	if !ok {
		return nil
	} // The request never reached this agent; nothing was changed.
	if op.State == "rolled_back" {
		return nil
	}
	current, e := os.ReadFile(m.ConfigPath)
	if e != nil {
		return e
	}
	if hash(current) != op.After {
		if hash(current) == hash(op.Before) && (op.State == "prepared" || op.State == "rollback_failed") {
			op.State = "rolled_back"
			m.state.Operations[id] = op
			return m.persist()
		}
		return errors.New("refusing rollback: config changed since this operation")
	}
	if m.status(ctx).Running {
		if e = m.observe(ctx); e != nil {
			return e
		}
	}
	if e = m.restore(ctx, op.Before); e != nil {
		op.State = "rollback_failed"
		m.state.Operations[id] = op
		_ = m.persist()
		return e
	}
	op.State = "rolled_back"
	m.state.Operations[id] = op
	return m.persist()
}
func (m *Manager) Restart(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status(ctx).Running {
		if e := m.observe(ctx); e != nil {
			return e
		}
	}
	return m.restart(ctx)
}
func (m *Manager) Keypair(ctx context.Context, wireguard bool) (map[string]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cmd := "x25519"
	if wireguard {
		cmd = "wg"
	}
	out, e := m.Runtime.Run(ctx, m.Binary, cmd)
	if e != nil {
		return nil, e
	}
	v := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		p := strings.SplitN(line, ":", 2)
		if len(p) != 2 {
			continue
		}
		k := strings.ToLower(p[0])
		if strings.Contains(k, "private") {
			v["private_key"] = strings.TrimSpace(p[1])
		}
		if strings.Contains(k, "public") || strings.Contains(k, "password") {
			v["public_key"] = strings.TrimSpace(p[1])
		}
	}
	if len(v) != 2 {
		return nil, errors.New("unexpected Xray key output")
	}
	return v, nil
}
func (m *Manager) Poll(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			_ = m.observe(ctx)
			m.mu.Unlock()
		}
	}
}

func oneTerminal(state string) bool { return state == "applied" || state == "rolled_back" }
