package agent

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

type Server struct {
	NodeID, Version, Token string
	Manager                *Manager
}

func (s Server) Handler() http.Handler {
	mux := http.NewServeMux()
	write := func(w http.ResponseWriter, code int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(v)
	}
	wrap := func(fn func(context.Context, map[string]json.RawMessage) (any, error), method string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			got := r.Header.Get("Authorization")
			want := "Bearer " + s.Token
			if len(got) != len(want) || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
				write(w, 401, map[string]string{"detail": "unauthorized"})
				return
			}
			if r.Method != method {
				w.Header().Set("Allow", method)
				write(w, 405, map[string]string{"detail": "method not allowed"})
				return
			}
			v := map[string]json.RawMessage{}
			if method == "POST" {
				r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
				if e := json.NewDecoder(r.Body).Decode(&v); e != nil {
					write(w, 400, map[string]string{"detail": "invalid JSON body"})
					return
				}
			}
			ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
			defer cancel()
			out, e := fn(ctx, v)
			if e != nil {
				write(w, 503, map[string]string{"detail": e.Error()})
				return
			}
			write(w, 200, out)
		}
	}
	mux.HandleFunc("/health", wrap(func(c context.Context, _ map[string]json.RawMessage) (any, error) {
		st := s.Manager.Status(c)
		status := "ok"
		if !st.Running {
			status = "degraded"
		}
		return map[string]any{"status": status, "node_id": s.NodeID, "version": s.Version, "time": time.Now().UTC(), "xray": st}, nil
	}, "GET"))
	mux.HandleFunc("/xray/status", wrap(func(c context.Context, _ map[string]json.RawMessage) (any, error) { return s.Manager.Status(c), nil }, "GET"))
	mux.HandleFunc("/xray/stats", wrap(func(c context.Context, _ map[string]json.RawMessage) (any, error) { return s.Manager.Stats(c) }, "GET"))
	mux.HandleFunc("/xray/ports", wrap(func(c context.Context, v map[string]json.RawMessage) (any, error) {
		checks, err := s.Manager.Ports(c, v["config"])
		return map[string]any{"ports": checks}, err
	}, "POST"))
	mux.HandleFunc("/xray/validate", wrap(func(c context.Context, v map[string]json.RawMessage) (any, error) {
		return map[string]string{"status": "valid"}, s.Manager.Validate(c, v["config"])
	}, "POST"))
	mux.HandleFunc("/xray/apply", wrap(func(c context.Context, v map[string]json.RawMessage) (any, error) {
		var id string
		_ = json.Unmarshal(v["operation_id"], &id)
		return map[string]string{"status": "applied", "operation_id": id}, s.Manager.Apply(c, id, v["config"])
	}, "POST"))
	mux.HandleFunc("/xray/rollback", wrap(func(c context.Context, v map[string]json.RawMessage) (any, error) {
		var id string
		_ = json.Unmarshal(v["operation_id"], &id)
		return map[string]string{"status": "rolled_back"}, s.Manager.Rollback(c, id)
	}, "POST"))
	mux.HandleFunc("/xray/restart", wrap(func(c context.Context, _ map[string]json.RawMessage) (any, error) {
		return map[string]string{"status": "restarted"}, s.Manager.Restart(c)
	}, "POST"))
	for path, wg := range map[string]bool{"/xray/x25519": false, "/xray/wg": true} {
		mux.HandleFunc(path, wrap(func(c context.Context, _ map[string]json.RawMessage) (any, error) { return s.Manager.Keypair(c, wg) }, "POST"))
	}
	return mux
}
func Serve(ctx context.Context, version string) error {
	env := func(k, d string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return d
	}
	token := env("VELORAY_AGENT_TOKEN", "")
	if len(token) < 32 {
		return errors.New("VELORAY_AGENT_TOKEN must contain at least 32 characters")
	}
	listen := env("VELORAY_AGENT_LISTEN", "127.0.0.1:9191")
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return err
	}
	cert, key := os.Getenv("VELORAY_NODE_CERT"), os.Getenv("VELORAY_NODE_KEY")
	loopback := strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
	if (cert == "") != (key == "") {
		return errors.New("both TLS certificate and key are required")
	}
	if cert == "" && !loopback {
		return errors.New("remote agent requires TLS")
	}
	m, err := NewManager(env("VELORAY_XRAY_BINARY", "/usr/local/bin/xray"), env("VELORAY_XRAY_CONFIG", "/usr/local/etc/xray/config.json"), env("VELORAY_XRAY_SERVICE", "xray.service"), env("VELORAY_AGENT_STATE", "/var/lib/veloray-agent/state.json"), nil)
	if err != nil {
		return err
	}
	go m.Poll(ctx)
	s := &http.Server{Addr: listen, Handler: Server{env("VELORAY_NODE_ID", "local"), version, token, m}.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 55 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = s.Shutdown(c)
	}()
	if cert != "" {
		s.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS13}
		if ca := os.Getenv("VELORAY_CA_CERT"); ca != "" {
			raw, e := os.ReadFile(ca)
			if e != nil {
				return e
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(raw) {
				return errors.New("invalid client CA certificate")
			}
			s.TLSConfig.ClientCAs = pool
			s.TLSConfig.ClientAuth = tls.RequireAndVerifyClientCert
		}
		return s.ListenAndServeTLS(cert, key)
	}
	return s.ListenAndServe()
}
