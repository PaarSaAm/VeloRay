package panel

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/pbkdf2"
)

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
func uuid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func passwordPolicy(username, password string) error {
	if len([]rune(password)) < 12 || len(password) > 1024 {
		return errors.New("password must contain 12–1024 characters")
	}
	if len(username) >= 3 && strings.Contains(strings.ToLower(password), strings.ToLower(username)) {
		return errors.New("password must not contain the username")
	}
	allDigits := true
	for _, r := range password {
		if r < '0' || r > '9' {
			allDigits = false
			break
		}
	}
	if allDigits {
		return errors.New("password must not contain only digits")
	}
	for _, p := range []string{"passwordpassword", "password123456", "123456789012", "qwerty123456", "administrator"} {
		if strings.EqualFold(password, p) {
			return errors.New("choose a less common password")
		}
	}
	return nil
}
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return "argon2id$v=19$m=65536,t=3,p=2$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}
func checkPassword(encoded, password string) bool {
	if len(password) > 1024 {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) == 4 && parts[0] == "pbkdf2_sha256" {
		iterations, err := strconv.Atoi(parts[1])
		if err != nil || iterations < 1 || iterations > 10000000 {
			return false
		}
		want, err := base64.StdEncoding.DecodeString(parts[3])
		if err != nil || len(want) != 32 {
			return false
		}
		got := pbkdf2.Key([]byte(password), []byte(parts[2]), iterations, 32, sha256.New)
		return subtle.ConstantTimeCompare(got, want) == 1
	}
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != "v=19" {
		return false
	}
	var memory, iterations uint32
	var parallel uint8
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &iterations, &parallel); err != nil || memory < 8 || memory > 128*1024 || iterations < 1 || iterations > 10 || parallel < 1 || parallel > 4 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(want) != 32 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, parallel, 32)
	return subtle.ConstantTimeCompare(got, want) == 1
}
func seal(secret, value string) (string, error) {
	if value == "" {
		return "", nil
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	out := aead.Seal(nonce, nonce, []byte(value), []byte("veloray:v1"))
	return "v1." + base64.RawURLEncoding.EncodeToString(out), nil
}
func unseal(secret, value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, "v1.") {
		return "", errors.New("unsupported encrypted field")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "v1."))
	if err != nil {
		return "", err
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	n := aead.NonceSize()
	if len(raw) < n {
		return "", errors.New("truncated encrypted field")
	}
	out, err := aead.Open(nil, raw[:n], raw[n:], []byte("veloray:v1"))
	return string(out), err
}

// legacyFernet reads the authenticated format used by v0.1.0. It is used only
// during the explicit, transactional import; normal requests use AES-GCM.
func legacyFernet(secret, value string) (string, error) {
	if value == "" {
		return "", nil
	}
	raw, err := base64.URLEncoding.DecodeString(value)
	if err != nil || len(raw) < 73 || raw[0] != 0x80 {
		return "", errors.New("invalid legacy encrypted field")
	}
	key := sha256.Sum256([]byte(secret))
	mac := hmac.New(sha256.New, key[:16])
	mac.Write(raw[:len(raw)-32])
	if !hmac.Equal(mac.Sum(nil), raw[len(raw)-32:]) {
		return "", errors.New("legacy field key does not match")
	}
	ciphertext := raw[25 : len(raw)-32]
	if len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return "", errors.New("invalid legacy ciphertext")
	}
	block, _ := aes.NewCipher(key[16:])
	out := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, raw[9:25]).CryptBlocks(out, ciphertext)
	padding := int(out[len(out)-1])
	if padding < 1 || padding > 16 || padding > len(out) {
		return "", errors.New("invalid legacy padding")
	}
	for _, b := range out[len(out)-padding:] {
		if int(b) != padding {
			return "", errors.New("invalid legacy padding")
		}
	}
	return string(out[:len(out)-padding]), nil
}
func totpCode(secret string, step int64) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", err
	}
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 15
	n := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", n%1000000), nil
}
func verifyTOTP(secret, code string, now time.Time, lastStep int64) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	step := now.Unix() / 30
	for _, n := range []int64{step, step - 1, step + 1} {
		if n <= lastStep {
			continue
		}
		want, err := totpCode(secret, n)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return n, true
		}
	}
	return 0, false
}
func csrfToken(secret string) string {
	token := randomToken(32)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(token))
	return token + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func validCSRF(secret, token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 180 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	got, err := base64.RawURLEncoding.DecodeString(parts[1])
	return err == nil && len(parts[0]) >= 32 && hmac.Equal(mac.Sum(nil), got)
}
