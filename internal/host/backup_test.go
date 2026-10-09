package host

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func archive(t *testing.T, files map[string][]byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "backup.tar.gz")
	f, e := os.Create(p)
	if e != nil {
		t.Fatal(e)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	for name, raw := range files {
		_ = tw.WriteHeader(&tar.Header{Name: name, Size: int64(len(raw)), Mode: 0600, Typeflag: tar.TypeReg})
		_, _ = tw.Write(raw)
	}
	_ = tw.Close()
	_ = gz.Close()
	_ = f.Close()
	return p
}
func TestBackupTraversalRejected(t *testing.T) {
	p := archive(t, map[string][]byte{"../../etc/passwd": []byte("attack")})
	if tmp, _, e := Verify(p); e == nil {
		os.RemoveAll(tmp)
		t.Fatal("path traversal accepted")
	}
}
func TestBackupHashesAndRequiredSecrets(t *testing.T) {
	files := map[string][]byte{"database.dump": []byte("dump"), "etc/veloray/veloray.env": []byte("VELORAY_FIELD_KEY=secret")}
	m := Manifest{Format: 1, Created: time.Now(), Files: map[string]Entry{}}
	for name, raw := range files {
		h := sha256.Sum256(raw)
		m.Files[name] = Entry{hex.EncodeToString(h[:]), int64(len(raw)), 0600}
	}
	raw, _ := json.Marshal(m)
	files["manifest.json"] = raw
	tmp, _, e := Verify(archive(t, files))
	if e != nil {
		t.Fatal(e)
	}
	os.RemoveAll(tmp)
	files["database.dump"] = []byte("tampered")
	if tmp, _, e = Verify(archive(t, files)); e == nil {
		os.RemoveAll(tmp)
		t.Fatal("tampered dump accepted")
	}
	delete(files, "etc/veloray/veloray.env")
	if tmp, _, e = Verify(archive(t, files)); e == nil {
		os.RemoveAll(tmp)
		t.Fatal("missing field key accepted")
	}
}
