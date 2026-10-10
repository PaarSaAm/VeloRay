# VeloRay

**An independently developed VPN management platform for Xray infrastructure.**

VeloRay brings server management, client provisioning and subscription delivery into one dedicated panel. It gives VPN operators a practical way to manage infrastructure, track usage and control access across local and remote servers.

Built with a Go backend, a Go node agent and a React interface, VeloRay keeps infrastructure management separate from VPN traffic. Xray handles connections directly; the panel manages configuration, accounts and service policies.

**Version:** `0.1.0` · **Backend:** Go · **Interface:** React / TypeScript · **Database:** PostgreSQL · **License:** MIT

## Built for everyday operations

- **Infrastructure management.** Manage local and remote nodes, inspect TCP and UDP listener ownership, validate and download configurations, deploy changes and recover stopped services. Connection presets cover common VLESS, Trojan, WireGuard and Hysteria2 setups. Remote agents support HTTPS, custom certificate authorities and optional mutual TLS.
- **Client lifecycle.** Create individual credentials, traffic allowances, expiry dates and scheduled renewals. Set a traffic multiplier or discount while retaining separate actual and billed counters. Provision up to 100 accounts in one atomic deployment, with distinct credentials and subscription addresses. Enable or disable access, export usage as CSV and reset quota periods while retaining recorded traffic history.
- **Migration.** Preview a 3x-ui or PasarGuard database backup, select inbounds and change conflicting ports. Import accounts, available traffic counters, credentials and supported connection settings as disabled entries. Shared accounts retain one quota across their connections and one subscription feed.
- **Subscription delivery.** Give each client a private subscription address and a browser portal with usage, expiry and a QR code. English and Persian portals support Base64, raw URI, JSON, Clash/Mihomo and WireGuard exports where supported.
- **Administrative control.** Administrator roles, TOTP two-factor authentication, recovery codes, scoped API keys and audit records help control access and trace changes.
- **Operational visibility.** Review host metrics, node health, socket conflicts and client traffic. Download a diagnostic report that excludes account credentials and agent tokens. Telegram owner commands and resource alerts provide an additional management channel.
- **Recovery tools.** Persistent accounting, configuration journals, retries and rollback handling support recovery from node failures. An interactive host menu handles service management, certificates, scheduled backups and restore.

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

Review `install.sh` before running it. The installer shows concise progress steps, keeps detailed output in a private installation log and checks the panel, database, agent, Xray and traffic accounting before confirming success. It asks for the public host and administrator password; the default panel port is `8443`. Normal installation needs access to GitHub and Ubuntu package servers. Building changed source additionally needs Go, Node.js and npm download services.

You can also install from an extracted source checkout with `sudo -E bash install.sh`. Use `--repo OWNER/REPOSITORY` and `--ref BRANCH_OR_TAG_OR_COMMIT` for a fork or a pinned version. Ref names must use letters, numbers, dots, underscores or hyphens.

To supply a local Xray archive, set `VELORAY_XRAY_ARCHIVE` and `VELORAY_XRAY_SHA256` before running the installer with `sudo -E`. An existing `/usr/local/bin/xray` is preserved.

For unattended installation, provide `VELORAY_PUBLIC_HOST`, `VELORAY_PANEL_PORT`, `VELORAY_ADMIN_USERNAME` and `VELORAY_ADMIN_PASSWORD`. Application keys are generated locally.

### HTTPS and remote nodes

The initial panel certificate is self-signed. Configure a domain and request a trusted certificate:

```bash
sudo veloray domain panel.example.com
sudo veloray ssl owner@example.com
```

Certificate issuance uses Nginx webroot challenges and keeps the panel running. The domain must resolve to this server and HTTP port `80` must be publicly reachable. Other Nginx sites retain their own server blocks. Xray runs as the dedicated `veloray-xray` account with group `nogroup`, preserving access to existing certificate copies. Place VPN certificate copies in a traversable directory such as `/usr/local/etc/xray/tls`, with owner `root`, group `nogroup` and file mode `0640`.

For a remote node, run:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/PaarSaAm/VeloRay/main/install.sh)" @ node
```

Keep the agent token private. Use a trusted agent certificate or configure `VELORAY_AGENT_CA_FILE` on the panel server. Add the HTTPS agent address and token in **Nodes**, then probe the connection. Restrict agent access to the panel server in your firewall.

## Management

Run `sudo veloray` to open the management menu. The menu shows the panel address and current service states, with English and Persian options.

```bash
sudo veloray
sudo veloray status
sudo veloray doctor
sudo veloray repair
sudo veloray ports
sudo veloray inbounds
sudo veloray logs xray
sudo veloray logs install
sudo veloray reset admin
sudo veloray backup
sudo veloray backup-schedule daily
sudo veloray restore /path/to/backup.tar.gz
sudo veloray update
```


`veloray` is the main server-management command. Running it without arguments opens the menu; it does not start another web server. `velorayctl` remains available with the same host-management actions. Use `veloray language fa` or `veloray language en` to change the menu language. Daily backups run around 03:00 in the server time zone and remain in `/var/lib/veloray/backups`. Disable scheduling with `veloray backup-schedule off`. Restore validates the archive, requires the word `RESTORE` and creates a recovery backup before replacing data.

Backups contain database data, application secrets, local certificates, configuration and the local agent ledger. Back up remote node state separately and keep all backups private.

| Component | Default listener |
| --- | --- |
| Panel HTTPS | `8443` |
| Panel backend | `127.0.0.1:8610` |
| Local agent | `127.0.0.1:9191` |
| Remote agent | HTTPS on `9191` |
| Xray statistics API | `127.0.0.1:10085` |

Environment files live at `/etc/veloray/veloray.env` and `/etc/veloray-node/agent.env`. Preserve the application encryption keys and agent ledger when maintaining the installation.

### Port conflicts and recovery

If a web server or another application already uses a VPN port, VeloRay shows the listener address and process owner before deploying a change. It recognizes listeners belonging to its current Xray service, checks TCP and UDP separately and checks IPv6 wildcard listeners. Availability is a snapshot; final runtime and accounting health checks still run after deployment.

On an interactive installation, you can select the saved inbound and a replacement port. If you leave the conflict unresolved, the panel starts for recovery and installation exits with an error. An existing failing Xray loop is stopped; the service occupying its port is preserved. Xray uses a bounded systemd restart policy.

Use **Xray Core → Listener checks** to inspect socket owners, or **Inbounds → Check port** to check a proposed listener. From the server console:

```bash
sudo veloray inbounds
sudo veloray ports
# Substitute the actual inbound ID and an available port.
sudo veloray inbound-port INBOUND_ID NEW_PORT
sudo veloray repair
```

An inbound port change uses the same deployment journal and database transaction as the panel. Configuration, saved port and subscription output update together. Credentials, expiry and recorded usage are retained. Users must refresh their subscription feeds to receive the new port. The command changes a VPN listener; `veloray port` changes the panel HTTPS port.

### Batch provisioning and reports

In **Clients → Batch create**, enter a prefix, account count, inbound, expiry and traffic policy. Names use `prefix-001`, `prefix-002` and so on. A failed deployment rolls back the entire batch. Shadowsocks retains its one-account-per-inbound restriction and is excluded from batch creation. Selected-account actions support up to 200 clients per operation and deploy once per affected node. Expired or exhausted accounts must be renewed before enabling access.

**Clients → Export usage** downloads the filtered directory without passwords or subscription tokens. **Xray Core → Diagnostics** downloads runtime state and listener ownership without the complete VPN configuration. Full configuration downloads contain credentials and should remain private.

### Traffic multipliers and discounts

**Clients → Add client / Batch create / Edit** accepts `traffic_multiplier` from `-1` to `3`, with at most three decimal places. The default is `1`. Positive values multiply actual traffic directly; negative values specify a discount, so the effective rate is `1 + traffic_multiplier`.

| Entered value | Billed for 1 GB of actual traffic |
| --- | --- |
| `-0.5` | 0.5 GB (50% discount) |
| `-0.25` | 0.75 GB (25% discount) |
| `0` or `-1` | 0 GB |
| `1` | 1 GB |
| `2` | 2 GB |
| `3` | 3 GB |

Quota enforcement uses billed traffic. Actual traffic is recorded separately; fractional bytes carry forward across polling cycles. Changing a multiplier first collects available counters at the previous rate and applies the new rate to subsequent traffic. Previously recorded usage is retained. Resetting usage clears both current-period counters while preserving their lifetime totals. Imported shared accounts use one policy and one quota across all their connections; editing, resetting or disabling a member affects that shared account.

### Import from 3x-ui or PasarGuard

Administrators can open **Import data**, select a target node and upload a SQLite backup (`.db`, `.sqlite`, `.sqlite3`) or the PasarGuard JSON export described below. The limit is 64 MiB, 20,000 source records, 500 inbounds and 10,000 client connections. SQL dumps and compressed archives are not import formats.

The preview shows supported entries, shared accounts, available used traffic, warnings and live port ownership when the node is reachable. Select entries, change saved-port collisions and review the warnings. **Import selected data** saves inbounds disabled without deploying to a running node. Repeating a completed request or importing the same source entries on the same node does not duplicate them. Preview tokens belong to the requesting administrator and expire after 30 minutes.

The adapters handle 3x-ui inline clients and global client/inbound relations, plus PasarGuard Xray core configurations and user/group/inbound relations. Source credentials, available current usage, limits and expiry are retained. PasarGuard reset-history records contribute to lifetime usage when present. A 3x-ui subscription token is retained where its format is valid and it is unique; the base address changes to the VeloRay server. PasarGuard subscription tokens are regenerated. A shared account's feed contains all its enabled supported connections.

PasarGuard PostgreSQL backups must first be exported from the source installation. The exporter requires `psql`, read access and the source connection URL in `SQLALCHEMY_DATABASE_URL` or `DATABASE_URL`. Load that variable privately from the source environment, then run:

```bash
python3 scripts/export-pasarguard.py --output /private/path/pasarguard-migration.json
# Alternatively, export an offline PasarGuard SQLite backup:
python3 scripts/export-pasarguard.py --sqlite /private/path/pasarguard.db --output /private/path/pasarguard-migration.json
```

The export contains VPN credentials and uses a private file; existing files are not overwritten. Upload it through **Import data**. Panel administrators, passwords, remote node credentials, host overrides, IP limits, fallback chains and calendar reset schedules are not migrated automatically. Review warnings, copy required TLS certificates to the target and inspect advanced stream settings before enabling each inbound. The adapter refuses unsupported protocols or settings rather than inventing replacement credentials. Stop the source listener or choose a new port before activation, then distribute the updated subscription addresses.

### Telegram management

In **Settings → Telegram bot**, save the bot token, allowed owner user IDs and language. Each owner must start a private chat with the bot. **Check bot connection** reports bot identity and polling state; **Send test to owners** sends to the configured owners; **Register owner commands** installs commands for those private owner chats. A bot with an existing webhook must be configured for polling before registration.

Commands include `/status`, `/nodes`, `/clients [page]`, `/search name`, `/client ID` and `/link ID`. Inline buttons support client details and paging. Optional alerts cover node resources, runtime failure/recovery, quota thresholds and approaching expiry, with cooldowns.

Changes are disabled by default. Enable bot management explicitly to use `/client ID enable|disable|reset` or `/node ID deploy|restart`. Every change requires an owner-bound confirmation valid for five minutes; a used or cancelled confirmation cannot execute again. The bot accepts only whitelisted senders in their own private chats. When administrator 2FA is mandatory, use the panel for changes. Failed reply delivery is retried from the saved reply without repeating the action. Owner operations appear in the audit log.

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
# Enter one password line, or provide VELORAY_ADMIN_PASSWORD.
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
python3 -m py_compile scripts/export-pasarguard.py internal/panel/import_reader.py
for script in install.sh scripts/*.sh scripts/velorayctl deploy/node/install.sh; do bash -n "$script"; done
bash scripts/test-installer.sh
```

Browser tests are in `frontend/tests`. Run them against an isolated panel with the `admin` test account, a node and an inbound. Set `VELORAY_E2E_URL` and `VELORAY_E2E_PASSWORD`, then run `npx playwright install chromium && npm test` in `frontend/`.

GitHub CI checks Go code, PostgreSQL integration, dependency vulnerabilities, the frontend build and shell syntax. The manual build workflow produces architecture-specific archives. Validate installation, backup restore, certificates and client connections on a separate server before enabling production traffic.

## Security and contributions

See [SECURITY.md](SECURITY.md) for deployment boundaries and responsible reporting. Never include passwords, node tokens, subscription links or unredacted logs in public issues.

For contributions, describe the problem and expected behavior, preserve API compatibility and include regression coverage for security, accounting or deployment changes.

## License

VeloRay is released under the MIT License. Xray and third-party dependencies retain their own licenses.
