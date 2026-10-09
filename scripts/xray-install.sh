#!/usr/bin/env bash
set -Eeuo pipefail
# Supply a locally downloaded Xray release and its expected SHA-256 digest.
# This avoids executing an unpinned installer fetched from the network.
[[ -n "${VELORAY_XRAY_ARCHIVE:-}" && "${VELORAY_XRAY_SHA256:-}" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Set VELORAY_XRAY_ARCHIVE and VELORAY_XRAY_SHA256 for an official Xray zip.' >&2;exit 1; }
printf '%s  %s\n' "$VELORAY_XRAY_SHA256" "$VELORAY_XRAY_ARCHIVE" | sha256sum -c -
tmp="$(mktemp -d)";trap 'rm -rf "$tmp"' EXIT
unzip -q "$VELORAY_XRAY_ARCHIVE" xray geoip.dat geosite.dat -d "$tmp"
install -m 0755 "$tmp/xray" /usr/local/bin/xray
install -d -m 0755 /usr/local/share/xray
install -m 0644 "$tmp/geoip.dat" "$tmp/geosite.dat" /usr/local/share/xray/
/usr/local/bin/xray version
