package host

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestSetEnvPreservesServiceGroup(t *testing.T) {
	groups, err := os.Getgroups()
	if err != nil {
		t.Fatal(err)
	}
	group := -1
	for _, gid := range groups {
		if gid != os.Getegid() {
			group = gid
			break
		}
	}
	if group == -1 {
		t.Skip("requires a supplementary group to reproduce service-group ownership")
	}
	path := filepath.Join(t.TempDir(), "veloray.env")
	if err := os.WriteFile(path, []byte("VELORAY_PANEL_PORT=8443\n"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(path, -1, group); err != nil {
		t.Fatal(err)
	}
	if err := SetEnv(path, "VELORAY_PANEL_PORT", "9443"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if int(info.Sys().(*syscall.Stat_t).Gid) != group || info.Mode().Perm() != 0640 {
		t.Fatal("configuration update changed the service group's read access")
	}
}

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
