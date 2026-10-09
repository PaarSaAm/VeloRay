package panel

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"golang.org/x/crypto/pbkdf2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPasswordAndLegacyUpgradeCompatibility(t *testing.T) {
	password := "s0mething-Quite-Long"
	hash, e := hashPassword(password)
	if e != nil || !checkPassword(hash, password) || checkPassword(hash, "incorrect") {
		t.Fatal("Argon2 verification failed")
	}
	legacy := fmt.Sprintf("pbkdf2_sha256$1000$salt$%s", base64.StdEncoding.EncodeToString(pbkdf2.Key([]byte(password), []byte("salt"), 1000, 32, sha256.New)))
	if !checkPassword(legacy, password) {
		t.Fatal("PBKDF2 compatibility failed")
	}
	for _, p := range []string{"short", "123456789012", "operator-password"} {
		if passwordPolicy("operator", p) == nil {
			t.Fatal("weak password accepted", p)
		}
	}
}
func TestEncryptionIntegrityAndWrongKey(t *testing.T) {
	cipher, e := seal("key-a", "secret")
	if e != nil {
		t.Fatal(e)
	}
	plain, e := unseal("key-a", cipher)
	if e != nil || plain != "secret" {
		t.Fatal(e, plain)
	}
	if _, e = unseal("key-b", cipher); e == nil {
		t.Fatal("wrong key accepted")
	}
	if _, e = unseal("key-a", cipher[:len(cipher)-3]+"AAA"); e == nil {
		t.Fatal("tamper accepted")
	}
}
func TestTOTPRFC6238AndReplay(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	now := time.Unix(59, 0)
	if got, _ := totpCode(secret, 1); got != "287082" {
		t.Fatal(got)
	}
	step, ok := verifyTOTP(secret, "287082", now, -1)
	if !ok {
		t.Fatal("code rejected")
	}
	if _, ok = verifyTOTP(secret, "287082", now, step); ok {
		t.Fatal("replay accepted")
	}
}
func TestLoginCSRFAndOrigin(t *testing.T) {
	c := Config{SecretKey: strings.Repeat("s", 32), TrustedOrigins: map[string]bool{"https://panel.example": true}}
	s := Server{Config: c}
	token := csrfToken(c.SecretKey)
	r := httptest.NewRequest("POST", "https://panel.example/api/auth/login", nil)
	r.Header.Set("Authorization", "Bearer fabricated")
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("X-CSRFToken", token)
	r.AddCookie(&http.Cookie{Name: "csrftoken", Value: token})
	if s.checkCSRF(r) == nil {
		t.Fatal("login CSRF bypass")
	}
	r.Header.Set("Origin", "https://panel.example")
	if e := s.checkCSRF(r); e != nil {
		t.Fatal(e)
	}
	r.Header.Set("X-CSRFToken", token+"x")
	if s.checkCSRF(r) == nil {
		t.Fatal("mismatch accepted")
	}
}
