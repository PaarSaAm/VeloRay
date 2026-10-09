#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]]||{ echo 'Run with sudo.' >&2;exit 1; }
cd "$(dirname "$0")/../.."
arch="$(uname -m)";case "$arch" in x86_64) arch=amd64;;aarch64|arm64) arch=arm64;;*) exit 1;;esac
[[ -x "bin/linux-$arch/veloray-agent" ]]||{ echo 'Build the agent first or use a release archive.' >&2;exit 1; }
(cd "bin/linux-$arch" && sha256sum -c SHA256SUMS)
apt-get update
apt-get install -y openssl curl unzip ca-certificates
[[ -x /usr/local/bin/xray ]]||bash scripts/xray-install.sh
install -d -m 0750 /etc/veloray-node
install -d -m 0700 /var/lib/veloray-agent
install -d -m 0755 /usr/local/etc/xray
if [[ -f /etc/veloray-node/agent.env ]];then
 set -a;source /etc/veloray-node/agent.env;set +a
 # Upgrade in place; preserve TLS keys, bearer token, accounting ledger and Xray config.
 cp -a /etc/veloray-node "/etc/veloray-node.backup-$(date -u +%Y%m%dT%H%M%SZ)"
else
 [[ -n "${VELORAY_PUBLIC_HOST:-}" ]]||read -rp 'Node public host: ' VELORAY_PUBLIC_HOST
 [[ "$VELORAY_PUBLIC_HOST" =~ ^[a-zA-Z0-9.:-]+$ ]]||exit 2
 VELORAY_AGENT_TOKEN="${VELORAY_AGENT_TOKEN:-$(openssl rand -hex 32)}"
 [[ ${#VELORAY_AGENT_TOKEN} -ge 32 ]]||exit 2
 port="${VELORAY_AGENT_PORT:-9191}"
 [[ "$port" =~ ^[0-9]+$ ]]&&((port>0&&port<65536&&port!=10085))||exit 2
 install -d -m 0700 /etc/veloray-node/tls
 san="DNS:$VELORAY_PUBLIC_HOST";[[ "$VELORAY_PUBLIC_HOST" != *:* && ! "$VELORAY_PUBLIC_HOST" =~ ^[0-9.]+$ ]]||san="IP:$VELORAY_PUBLIC_HOST"
 openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 -keyout /etc/veloray-node/tls/agent.key -out /etc/veloray-node/tls/agent.crt -subj "/CN=$VELORAY_PUBLIC_HOST" -addext "subjectAltName=$san" >/dev/null 2>&1
 chmod 0600 /etc/veloray-node/tls/agent.key
 cat >/etc/veloray-node/agent.env <<ENV
VELORAY_NODE_ID=$VELORAY_PUBLIC_HOST
VELORAY_AGENT_LISTEN=0.0.0.0:$port
VELORAY_AGENT_TOKEN=$VELORAY_AGENT_TOKEN
VELORAY_NODE_CERT=/etc/veloray-node/tls/agent.crt
VELORAY_NODE_KEY=/etc/veloray-node/tls/agent.key
VELORAY_XRAY_BINARY=/usr/local/bin/xray
VELORAY_XRAY_CONFIG=/usr/local/etc/xray/config.json
VELORAY_XRAY_SERVICE=xray.service
VELORAY_AGENT_STATE=/var/lib/veloray-agent/state.json
ENV
 chmod 0600 /etc/veloray-node/agent.env
fi
# Bootstrap with no public listeners; the panel deploys the requested inbounds.
if [[ ! -f /usr/local/etc/xray/config.json ]];then
 cat >/usr/local/etc/xray/config.json <<'JSON'
{"log":{"loglevel":"warning"},"api":{"tag":"api","services":["StatsService"]},"stats":{},"policy":{"levels":{"0":{"statsUserUplink":true,"statsUserDownlink":true}},"system":{"statsInboundUplink":true,"statsInboundDownlink":true}},"inbounds":[{"tag":"api","listen":"127.0.0.1","port":10085,"protocol":"dokodemo-door","settings":{"address":"127.0.0.1"}}],"outbounds":[{"protocol":"freedom","tag":"direct"}],"routing":{"rules":[{"type":"field","inboundTag":["api"],"outboundTag":"api"}]}}
JSON
fi
chown root:nogroup /usr/local/etc/xray/config.json;chmod 0640 /usr/local/etc/xray/config.json
install -m 0755 "bin/linux-$arch/veloray-agent" /usr/local/bin/veloray-agent
install -m 0644 deploy/systemd/{veloray-agent,xray}.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now xray.service
systemctl enable veloray-agent.service
systemctl restart veloray-agent.service
systemctl is-active --quiet veloray-agent.service xray.service
printf '\nAgent installed. Restrict its firewall port to the panel server.\n'
printf 'Token: %s\nCertificate SHA-256: ' "$VELORAY_AGENT_TOKEN"
openssl x509 -in "${VELORAY_NODE_CERT:-/etc/veloray-node/tls/agent.crt}" -noout -fingerprint -sha256
printf 'For verified TLS, use a trusted certificate or add this certificate to the panel CA bundle.\n'
