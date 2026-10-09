#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
go test -race ./... -count=1
go vet ./...
(cd frontend && npm ci --no-audit --no-fund && npm run format:check && npm run build)
for script in install.sh scripts/*.sh scripts/velorayctl deploy/node/install.sh; do bash -n "$script"; done
[[ -n "${VELORAY_TEST_DATABASE_URL:-}" ]]||echo 'Set VELORAY_TEST_DATABASE_URL to run database integration tests.' >&2

bash scripts/test-installer.sh
