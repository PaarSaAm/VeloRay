#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]]||{ echo 'Run with sudo.' >&2;exit 1; }
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source_dir="$PWD"
prompt() { if [[ "${VELORAY_INSTALL_LANG:-en}" == fa ]];then printf '%s' "$2";else printf '%s' "$1";fi; }
arch="$(uname -m)";case "$arch" in x86_64) arch=amd64;;aarch64|arm64) arch=arm64;;*) echo 'Unsupported CPU' >&2;exit 1;;esac
[[ -f go.mod && -f frontend/package-lock.json ]]||{ echo 'Extract a complete VeloRay release first.' >&2;exit 1; }
if [[ ! -x "bin/linux-$arch/veloray" || ! -f frontend/dist/index.html ]];then bash scripts/build.sh "$arch";fi
(cd "bin/linux-$arch" && sha256sum -c SHA256SUMS)
apt-get update
apt-get install -y postgresql postgresql-client nginx openssl curl unzip certbot ca-certificates
id veloray >/dev/null 2>&1||useradd --system --home /var/lib/veloray --shell /usr/sbin/nologin veloray
install -d -o veloray -g veloray -m 0750 /var/lib/veloray
install -d -m 0750 /etc/veloray /etc/veloray-node
chown root:veloray /etc/veloray
install -d -m 0700 /var/lib/veloray-agent
install -d -m 0755 /opt/veloray/releases /usr/local/etc/xray /etc/nginx/sites-available /etc/nginx/sites-enabled
version="$(bin/linux-$arch/veloray version)"
release="/opt/veloray/releases/$version-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$release/frontend"
cp -a frontend/dist "$release/frontend/"
cp -a frontend/package-lock.json frontend/package.json "$release/frontend/"
cp -a deploy scripts install.sh go.mod "$release/"
mkdir -p "$release/bin/linux-$arch"
cp -a "bin/linux-$arch/"* "$release/bin/linux-$arch/"
[[ -x /usr/local/bin/xray ]]||bash scripts/xray-install.sh
systemctl enable --now postgresql nginx
existing=false
if [[ -f /etc/veloray/veloray.env ]];then
 existing=true
 set -a;source /etc/veloray/veloray.env;set +a
 [[ "${POSTGRES_HOST:-}" != 127.0.1.0 ]]||export POSTGRES_HOST=127.0.0.1
 # Database and encryption keys are preserved. No account reset during upgrades.
 [[ -n "${VELORAY_FIELD_KEY:-}" && -n "${VELORAY_SECRET_KEY:-}" ]]||{ echo 'Existing secrets are missing.' >&2;exit 1; }
 if [[ -x /usr/local/bin/veloray && ! -f /opt/veloray/src/backend/manage.py ]];then /usr/local/bin/veloray backup "/var/lib/veloray/backups-pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).tar.gz";else
  backup="/var/lib/veloray/legacy-pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ)";install -d -m 0700 "$backup"
  PGHOST="${POSTGRES_HOST:-127.0.0.1}" PGPORT="${POSTGRES_PORT:-5432}" PGUSER="${POSTGRES_USER:-veloray}" PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -Fc --no-owner --no-acl "${POSTGRES_DB:-veloray}" >"$backup/database.dump"
  cp -a /etc/veloray "$backup/";[[ ! -d /etc/veloray-node ]]||cp -a /etc/veloray-node "$backup/";cp -a /usr/local/etc/xray "$backup/";chmod -R go-rwx "$backup"
 fi
 systemctl stop veloray-web.service veloray-reconcile.timer veloray-reconcile.service 2>/dev/null||true
else
 [[ -n "${VELORAY_PUBLIC_HOST:-}" ]]||read -rp "$(prompt 'Public host (domain or IP): ' 'دامنه یا آی‌پی عمومی: ')" VELORAY_PUBLIC_HOST
 [[ "$VELORAY_PUBLIC_HOST" =~ ^[a-zA-Z0-9.:-]+$ ]]||{ echo 'Invalid host.' >&2;exit 2; }
 VELORAY_PANEL_PORT="${VELORAY_PANEL_PORT:-8443}"
 [[ "$VELORAY_PANEL_PORT" =~ ^[0-9]+$ ]]&&((VELORAY_PANEL_PORT>0&&VELORAY_PANEL_PORT<65536))||exit 2
 public_url_host="$VELORAY_PUBLIC_HOST";[[ "$public_url_host" != *:* ]]||public_url_host="[$public_url_host]"
 dbpass="$(openssl rand -hex 32)"
 # Fixed database identifiers; user input is never interpolated into SQL.
 runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE veloray WITH LOGIN PASSWORD '$dbpass';"
 runuser -u postgres -- createdb -O veloray veloray
 cat >/etc/veloray/veloray.env <<ENV
VELORAY_SECRET_KEY=$(openssl rand -hex 48)
VELORAY_FIELD_KEY=$(openssl rand -hex 32)
VELORAY_PUBLIC_HOST=$VELORAY_PUBLIC_HOST
VELORAY_PANEL_PORT=$VELORAY_PANEL_PORT
VELORAY_PUBLIC_URL=https://$public_url_host:$VELORAY_PANEL_PORT
VELORAY_LISTEN=127.0.0.1:8610
VELORAY_COOKIE_SECURE=true
VELORAY_LOCAL_NODE_TOKEN=$(openssl rand -hex 32)
VELORAY_FRONTEND_DIR=/opt/veloray/current/frontend/dist
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=veloray
POSTGRES_USER=veloray
POSTGRES_PASSWORD=$dbpass
ENV
 set -a;source /etc/veloray/veloray.env;set +a
 [[ "${POSTGRES_HOST:-}" != 127.0.1.0 ]]||export POSTGRES_HOST=127.0.0.1
fi
chown root:veloray /etc/veloray/veloray.env;chmod 0640 /etc/veloray/veloray.env
# All changes below use the candidate binary. Keep the previous release for rollback.
install -m 0755 "bin/linux-$arch/veloray" /usr/local/bin/veloray
install -m 0755 "bin/linux-$arch/veloray-agent" /usr/local/bin/veloray-agent
install -m 0755 scripts/velorayctl /usr/local/bin/velorayctl
export VELORAY_PUBLIC_HOST="${VELORAY_PUBLIC_HOST:-localhost}"
export VELORAY_PANEL_PORT="${VELORAY_PANEL_PORT:-8443}"
VELORAY_LOCAL_NODE_TOKEN="${VELORAY_LOCAL_NODE_TOKEN:-$(openssl rand -hex 32)}"
public_url_host="$VELORAY_PUBLIC_HOST";[[ "$public_url_host" != *:* ]]||public_url_host="[$public_url_host]"
export VELORAY_PUBLIC_URL="https://$public_url_host:$VELORAY_PANEL_PORT"
veloray set-env VELORAY_PUBLIC_URL "$VELORAY_PUBLIC_URL"
veloray set-env VELORAY_FRONTEND_DIR /opt/veloray/current/frontend/dist
veloray set-env VELORAY_LOCAL_NODE_TOKEN "$VELORAY_LOCAL_NODE_TOKEN"
veloray set-env VELORAY_LISTEN 127.0.0.1:8610
veloray set-env VELORAY_COOKIE_SECURE true
veloray set-env POSTGRES_HOST "${POSTGRES_HOST:-127.0.0.1}"
veloray migrate
if $existing;then
 legacy="$(PGHOST="${POSTGRES_HOST:-127.0.0.1}" PGPORT="${POSTGRES_PORT:-5432}" PGUSER="${POSTGRES_USER:-veloray}" PGPASSWORD="$POSTGRES_PASSWORD" psql -tAc "SELECT to_regclass('core_node') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vr_users)" "${POSTGRES_DB:-veloray}")"
 if [[ "${legacy//[[:space:]]/}" == t ]];then veloray import-legacy --dry-run;veloray import-legacy;fi
else
 export VELORAY_ADMIN_USERNAME="${VELORAY_ADMIN_USERNAME:-admin}"
 if [[ -z "${VELORAY_ADMIN_PASSWORD:-}" ]];then read -rsp "$(prompt 'Administrator password (12+ characters): ' 'رمز مدیر (حداقل ۱۲ کاراکتر): ')" VELORAY_ADMIN_PASSWORD;echo;fi
 export VELORAY_ADMIN_PASSWORD
 veloray bootstrap
 unset VELORAY_ADMIN_PASSWORD
fi
veloray bootstrap-local
# Preserve existing Xray configuration. The upgraded agent can harvest the old API address.
if [[ ! -f /usr/local/etc/xray/config.json ]];then
 cat >/usr/local/etc/xray/config.json <<'JSON'
{"log":{"loglevel":"warning"},"api":{"tag":"api","services":["StatsService"]},"stats":{},"policy":{"levels":{"0":{"statsUserUplink":true,"statsUserDownlink":true}},"system":{"statsInboundUplink":true,"statsInboundDownlink":true}},"inbounds":[{"tag":"api","listen":"127.0.0.1","port":10085,"protocol":"dokodemo-door","settings":{"address":"127.0.0.1"}}],"outbounds":[{"protocol":"freedom","tag":"direct"}],"routing":{"rules":[{"type":"field","inboundTag":["api"],"outboundTag":"api"}]}}
JSON
fi
chown root:nogroup /usr/local/etc/xray/config.json;chmod 0640 /usr/local/etc/xray/config.json
cat >/etc/veloray-node/agent.env <<ENV
VELORAY_NODE_ID=local
VELORAY_AGENT_LISTEN=127.0.0.1:9191
VELORAY_AGENT_TOKEN=$VELORAY_LOCAL_NODE_TOKEN
VELORAY_XRAY_BINARY=/usr/local/bin/xray
VELORAY_XRAY_CONFIG=/usr/local/etc/xray/config.json
VELORAY_XRAY_SERVICE=xray.service
VELORAY_AGENT_STATE=/var/lib/veloray-agent/state.json
ENV
chmod 0600 /etc/veloray-node/agent.env
install -m 0644 deploy/systemd/{veloray-web,veloray-agent,xray}.service /etc/systemd/system/
ln -sfn "$release" /opt/veloray/current
systemctl disable --now veloray-reconcile.timer 2>/dev/null||true
systemctl daemon-reload
systemctl enable --now xray.service
systemctl restart veloray-agent.service
systemctl enable veloray-agent.service veloray-web.service
veloray render-nginx
systemctl restart veloray-web.service
for attempt in {1..15};do if curl -fsS --max-time 3 http://127.0.0.1:8610/api/health >/dev/null;then break;fi;sleep 1;done
velorayctl doctor
echo "VeloRay $version installed. Open https://$VELORAY_PUBLIC_HOST:$VELORAY_PANEL_PORT"
echo 'Use velorayctl for service management. The initial TLS certificate is self-signed.'

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/veloray-nginx <<'HOOK'
#!/usr/bin/env bash
systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/veloray-nginx
