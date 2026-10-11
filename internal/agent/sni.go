package agent

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

type SNIResult struct {
	Domain  string `json:"domain"`
	Valid   bool   `json:"valid"`
	Latency int64  `json:"latency_ms"`
	Version string `json:"tls_version"`
	ALPN    string `json:"alpn"`
	Expires string `json:"certificate_expiry,omitempty"`
	Error   string `json:"error,omitempty"`
}

func publicIP(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !ip.IsMulticast() && ip.IsGlobalUnicast()
}
func scanSNI(ctx context.Context, domains []string) ([]SNIResult, error) {
	if len(domains) == 0 {
		domains = []string{"www.cloudflare.com", "www.microsoft.com", "www.apple.com", "www.amazon.com", "www.wikipedia.org", "www.bing.com"}
	}
	if len(domains) > 12 {
		return nil, errors.New("maximum 12 domains")
	}
	out := make([]SNIResult, len(domains))
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for index, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if len(domain) > 253 || strings.ContainsAny(domain, "/:@ \n\r") || !strings.Contains(domain, ".") {
			return nil, errors.New("enter a domain without a URL or port")
		}
		wg.Add(1)
		go func(index int, domain string) {
			defer wg.Done()
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				out[index] = SNIResult{Domain: domain, Error: ctx.Err().Error()}
				return
			}
			defer func() { <-slots }()
			out[index] = probeSNI(ctx, domain)
		}(index, domain)
	}
	wg.Wait()
	return out, nil
}
func probeSNI(parent context.Context, domain string) SNIResult {
	r := SNIResult{Domain: domain}
	ctx, cancel := context.WithTimeout(parent, 4*time.Second)
	defer cancel()
	start := time.Now()
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, domain)
	if e != nil {
		r.Error = e.Error()
		return r
	}
	if len(ips) == 0 {
		r.Error = "no DNS addresses"
		return r
	}
	for _, ip := range ips {
		if !publicIP(ip.IP) {
			r.Error = "domain resolves to a non-public address"
			return r
		}
	}
	dialer := net.Dialer{Timeout: 3 * time.Second}
	var conn net.Conn
	for _, ip := range ips {
		conn, e = dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip.IP.String(), "443"))
		if e == nil {
			break
		}
	}
	if e != nil {
		r.Error = e.Error()
		return r
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	secure := tls.Client(conn, &tls.Config{ServerName: domain, MinVersion: tls.VersionTLS13, CurvePreferences: []tls.CurveID{tls.X25519}, NextProtos: []string{"h2", "http/1.1"}})
	e = secure.HandshakeContext(ctx)
	r.Latency = time.Since(start).Milliseconds()
	if e != nil {
		r.Error = e.Error()
		return r
	}
	state := secure.ConnectionState()
	r.Valid = true
	r.Version = fmt.Sprintf("TLS %s", tls.VersionName(state.Version))
	r.ALPN = state.NegotiatedProtocol
	if len(state.PeerCertificates) > 0 {
		r.Expires = state.PeerCertificates[0].NotAfter.UTC().Format(time.RFC3339)
	}
	return r
}
