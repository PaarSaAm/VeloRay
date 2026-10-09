package panel

import (
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func testTLS(t *testing.T) (string, string) {
	t.Helper()
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "vpn.example"}, DNSNames: []string{"vpn.example"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	priv, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	cert, p := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	_ = os.WriteFile(cert, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600)
	_ = os.WriteFile(p, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: priv}), 0600)
	return cert, p
}
func TestIntegrationXrayGeneratedProtocolMatrix(t *testing.T) {
	binary := os.Getenv("VELORAY_TEST_XRAY_BINARY")
	if binary == "" {
		t.Skip("set VELORAY_TEST_XRAY_BINARY for real Xray validation")
	}
	s, ctx := integration(t)
	n, i, c := fixture(t, s, ctx, &nodeMock{running: true})
	cert, key := testTLS(t)
	wg, e := ecdh.X25519().GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	matrix := [][3]string{{"vless", "raw", "none"}, {"vless", "raw", "reality"}, {"vless", "ws", "tls"}, {"vless", "grpc", "tls"}, {"vless", "xhttp", "reality"}, {"vless", "httpupgrade", "tls"}, {"vmess", "mkcp", "none"}, {"trojan", "raw", "tls"}, {"shadowsocks", "raw", "none"}, {"hysteria", "hysteria", "tls"}, {"wireguard", "raw", "none"}, {"http", "raw", "none"}, {"socks", "raw", "none"}, {"tunnel", "raw", "none"}, {"tun", "raw", "none"}}
	for _, v := range matrix {
		t.Run(v[0]+"/"+v[1]+"/"+v[2], func(t *testing.T) {
			if v[0] == "tun" {
				if _, err := os.Stat("/dev/net/tun"); err != nil {
					t.Skip("TUN device unavailable; validate on the target host")
				}
			}
			i["protocol"], i["transport"], i["security"] = v[0], v[1], v[2]
			i["tls_cert_file"], i["tls_key_file"] = cert, key
			i["reality_dest"] = "example.com:443"
			i["reality_server_name"] = "example.com"
			i["reality_private_key"] = base64.RawURLEncoding.EncodeToString(wg.Bytes())
			i["reality_public_key"] = base64.RawURLEncoding.EncodeToString(wg.PublicKey().Bytes())
			i["protocol_settings"] = Data{"secret_key": base64.StdEncoding.EncodeToString(wg.Bytes()), "public_key": base64.StdEncoding.EncodeToString(wg.PublicKey().Bytes()), "rewrite_port": 443}
			c["protocol_settings"] = Data{"private_key": base64.StdEncoding.EncodeToString(wg.Bytes()), "public_key": base64.StdEncoding.EncodeToString(wg.PublicKey().Bytes()), "address": "10.66.1.2/32", "username": "alice"}
			if e := save(ctx, s.Store.Pool, "inbounds", i); e != nil {
				t.Fatal(e)
			}
			if e := save(ctx, s.Store.Pool, "clients", c); e != nil {
				t.Fatal(e)
			}
			cfg, e := buildConfig(ctx, s.Store.Pool, n)
			if e != nil {
				t.Fatal(e)
			}
			raw, _ := json.MarshalIndent(cfg, "", "  ")
			p := filepath.Join(t.TempDir(), "config.json")
			if e = os.WriteFile(p, raw, 0600); e != nil {
				t.Fatal(e)
			}
			if out, e := exec.Command(binary, "run", "-test", "-config", p).CombinedOutput(); e != nil {
				t.Fatalf("Xray rejected %s: %s", v, out)
			}
		})
	}
}
