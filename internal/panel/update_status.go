package panel

import (
	"net/http"
	"os"
	"regexp"
	"strings"
)

const (
	installedCommitPath = "/var/lib/veloray/installed-commit"
	autoUpdateTimerLink = "/etc/systemd/system/timers.target.wants/veloray-auto-update.timer"
)

var commitIDPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)

// updateStatus reports local metadata only. Installing system packages and
// starting root-owned timers is deliberately kept out of the HTTP API.
func updateStatus() Data {
	installed := ""
	if raw, err := os.ReadFile(installedCommitPath); err == nil {
		candidate := strings.TrimSpace(string(raw))
		if commitIDPattern.MatchString(candidate) {
			installed = candidate
		}
	}
	_, err := os.Lstat(autoUpdateTimerLink)
	return Data{
		"repository":         "ParsaZali/VeloRay",
		"tracking_branch":    "main",
		"installed_commit":   installed,
		"auto_update_enabled": err == nil,
		"verification":       "github-main-ci-and-pinned-commit",
	}
}

func (s *Server) updatesAPI(r *http.Request, path string) (any, int, error) {
	if path != "updates/status" || r.Method != http.MethodGet {
		return nil, 0, fail(http.StatusMethodNotAllowed, "method not allowed")
	}
	return updateStatus(), http.StatusOK, nil
}
