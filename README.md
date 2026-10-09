# VeloRay

**An independently developed VPN management platform for Xray infrastructure.**

VeloRay brings server management, client provisioning and subscription delivery into one dedicated panel. It gives VPN operators a practical way to manage infrastructure, track usage and control access across local and remote servers.

Built with a Go backend, a Go node agent and a React interface, VeloRay keeps infrastructure management separate from VPN traffic. Xray handles connections directly; the panel manages configuration, accounts and service policies.

**Version:** `0.1.0` · **Backend:** Go · **Interface:** React / TypeScript · **Database:** PostgreSQL · **License:** MIT

## Built for everyday operations

- **Infrastructure management.** Manage local and remote nodes, check runtime status, preview configurations, deploy changes and restart services. Remote agents support HTTPS, custom certificate authorities and optional mutual TLS.
- **Client lifecycle.** Create individual credentials, traffic allowances, expiry dates and scheduled renewals. Enable or disable access and reset quota periods while retaining recorded traffic history.
- **Subscription delivery.** Give each client a private subscription address and a browser portal with usage, expiry and a QR code. English and Persian portals support Base64, raw URI, JSON, Clash/Mihomo and WireGuard exports where supported.
- **Administrative control.** Administrator roles, TOTP two-factor authentication, recovery codes, scoped API keys and audit records help control access and trace changes.
- **Operational visibility.** Review host metrics, node health and client traffic. Telegram owner commands and resource alerts provide an additional management channel.
- **Recovery tools.** Persistent accounting, configuration journals, retries and rollback handling support recovery from node failures. A host CLI handles service management, certificates, backups and restore.

## Protocols

| Area | Support |
| --- | --- |
| Client protocols | VLESS, VMess, Trojan, Shadowsocks, Hysteria2, WireGuard, HTTP and SOCKS |
| Additional inbounds | Tunnel and TUN |
| Transports | RAW, WebSocket, gRPC, XHTTP, HTTPUpgrade, mKCP and Hysteria, depending on the protocol |
| Connection security | TLS and REALITY, where supported |

HTTP and SOCKS do not provide per-account traffic accounting in this implementation and cannot use traffic quotas. Shadowsocks supports one client per inbound. TUN requires a working TUN device, suitable privileges and host routing. Export compatibility depends on the client application and version.

## Installation

Use a dedicated **Ubuntu 24.04** server with systemd and an amd64 or arm64 processor. The installation configures PostgreSQL, service units and an Nginx HTTPS endpoint.

Run the installer directly from GitHub:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/PaarSaAm/VeloRay/main/install.sh)" @ install --database postgresql
```

For Persian installation prompts:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/PaarSaAm/VeloRay/main/install.sh)" @ install --database postgresql --lang fa
```

PostgreSQL is the supported database. Omitting `--database` selects PostgreSQL. SQLite, MySQL, MariaDB and TimescaleDB switches are not supported.

This package includes verified Linux runtimes for amd64 and arm64: the panel, node agent, compiled web interface, Xray `v26.3.27`, GeoIP and GeoSite data. Normal installation does not require Go or Node.js, or a separate Xray download. The installer checks archive checksums and confirms that the binaries match the supplied source files before installing them.

The GitHub download is pinned to a resolved commit and uses alternate archive routes if a route fails. A source checkout without runtime packages, or with changed build inputs, is built locally. In that case the installer prepares missing Go and Node.js tools from verified official downloads, tries alternate routes and supported versions, and reuses cached tools on subsequent runs. These tools are placed under `/opt/veloray/toolchains`.

Review `install.sh` before running it. The installer asks for the public host and administrator password; the default panel port is `8443`. Normal installation needs access to GitHub and Ubuntu package servers. Building changed source additionally needs Go, Node.js and npm download services.

You can also install from an extracted source checkout with `sudo -E bash install.sh`. Use `--repo OWNER/REPOSITORY` and `--ref BRANCH_OR_TAG_OR_COMMIT` for a fork or a pinned version. Ref names must use letters, numbers, dots, underscores or hyphens.

To supply a local Xray archive, set `VELORAY_XRAY_ARCHIVE` and `VELORAY_XRAY_SHA256` before running the installer with `sudo -E`. An existing `/usr/local/bin/xray` is preserved.

For unattended installation, provide `VELORAY_PUBLIC_HOST`, `VELORAY_PANEL_PORT`, `VELORAY_ADMIN_USERNAME` and `VELORAY_ADMIN_PASSWORD`. Application keys are generated locally.

### HTTPS and remote nodes

The initial panel certificate is self-signed. Configure a domain and request a trusted certificate:

```bash
sudo velorayctl domain panel.example.com
sudo velorayctl ssl owner@example.com
```

The standalone certificate challenge needs a free, publicly reachable port `80`. VPN certificates must be readable by Xray's `nobody:nogroup` service account. Place certificate copies in a traversable directory such as `/usr/local/etc/xray/tls`, with owner `root`, group `nogroup` and file mode `0640`.

For a remote node, run:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/PaarSaAm/VeloRay/main/install.sh)" @ node
```

Keep the agent token private. Use a trusted agent certificate or configure `VELORAY_AGENT_CA_FILE` on the panel server. Add the HTTPS agent address and token in **Nodes**, then probe the connection. Restrict agent access to the panel server in your firewall.

## Management

```bash
sudo velorayctl status
sudo velorayctl doctor
sudo velorayctl logs web
sudo velorayctl backup
sudo velorayctl restore /path/to/backup.tar.gz
sudo velorayctl admin-reset admin
sudo velorayctl update /path/to/built-project
sudo veloray uninstall
```

`veloray` handles application and database commands. `velorayctl` manages services and the host installation. Backups contain database data, application secrets, local certificates, configuration and the local agent ledger. Back up remote node state separately and keep all backups private.

| Component | Default listener |
| --- | --- |
| Panel HTTPS | `8443` |
| Panel backend | `127.0.0.1:8610` |
| Local agent | `127.0.0.1:9191` |
| Remote agent | HTTPS on `9191` |
| Xray statistics API | `127.0.0.1:10085` |

Environment files live at `/etc/veloray/veloray.env` and `/etc/veloray-node/agent.env`. Preserve the application encryption keys and agent ledger when maintaining the installation.

Uninstall removes VeloRay services and program files after confirmation. It preserves configuration, application encryption keys, PostgreSQL data, certificates and the accounting ledger. Running the installer again reuses that state. If an older uninstall removed `/etc/veloray/veloray.env` while keeping PostgreSQL data, restore the environment file from a backup first; the installer stops rather than generate replacement keys for existing encrypted data. Interrupted first-time installs can resume without resetting an existing administrator.

## Development

Requirements: Go 1.26+, Node.js 22.12+, PostgreSQL 15+ and a compatible Xray runtime for node integration.

Rebuild both distributable runtime packages after changing application source:

```bash
bash scripts/build-runtime.sh
```

Runtime packages include component license notices. Xray is distributed under its own license; its source is available at [XTLS/Xray-core](https://github.com/XTLS/Xray-core/tree/v26.3.27).

```bash
cp .env.example .env
# Set distinct random application keys and a database password.
# Each application key must contain at least 32 characters.
docker compose up -d db
set -a; source .env; set +a
export VELORAY_ENV_FILE=.env

go run ./cmd/veloray migrate
VELORAY_ADMIN_USERNAME=admin go run ./cmd/veloray bootstrap
# Enter the administrator password on stdin, then end input.
go run ./cmd/veloray serve
```

Start the interface in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The development proxy forwards API and subscription requests to the backend. Use the same hostname consistently so session and CSRF cookies match.

### Tests and builds

Use a disposable database: integration tests clear application tables and create temporary fixtures.

```bash
export VELORAY_TEST_DATABASE_URL='postgres://veloray:password@127.0.0.1:5432/veloray_test?sslmode=disable'
go test -race ./...
go vet ./...
(cd frontend && npm ci && npm run format:check && npm run build)
for script in install.sh scripts/*.sh scripts/velorayctl deploy/node/install.sh; do bash -n "$script"; done
bash scripts/test-installer.sh
```

Browser tests are in `frontend/tests`. Run them against an isolated panel with the `admin` test account, a node and an inbound. Set `VELORAY_E2E_URL` and `VELORAY_E2E_PASSWORD`, then run `npx playwright install chromium && npm test` in `frontend/`.

GitHub CI checks Go code, PostgreSQL integration, dependency vulnerabilities, the frontend build and shell syntax. The manual build workflow produces architecture-specific archives. Test installation, restore and actual client connections on a separate server before enabling production traffic.

## Security and contributions

See [SECURITY.md](SECURITY.md) for deployment boundaries and responsible reporting. Never include passwords, node tokens, subscription links or unredacted logs in public issues.

For contributions, describe the problem and expected behavior, preserve API compatibility and include regression coverage for security, accounting or deployment changes.

## License

VeloRay is released under the MIT License. Xray and third-party dependencies retain their own licenses.
