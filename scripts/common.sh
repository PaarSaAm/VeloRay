#!/usr/bin/env bash
# Shared host operations. Sourcing this file never changes services or data.
vr_text() { if [[ "${VELORAY_INSTALL_LANG:-${VELORAY_LANGUAGE:-en}}" == fa ]];then printf '%s' "$2";else printf '%s' "$1";fi; }
vr_say() { vr_text "$1" "$2";printf '\n'; }
vr_step() { VR_STEP="$(vr_text "$1" "$2")";printf '\n  • %s\n' "$VR_STEP"; }
vr_log_init() {
 local previous_mask="$(umask)"
 umask 077
 if [[ -z "${VELORAY_INSTALL_LOG:-}" ]];then
  install -d -m 0700 /var/log/veloray
  VELORAY_INSTALL_LOG="$(mktemp "/var/log/veloray/${1:-operation}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.log")"
 fi
 [[ -f "$VELORAY_INSTALL_LOG" && ! -L "$VELORAY_INSTALL_LOG" ]]||{ echo 'Invalid operation log.' >&2;return 1; }
 chmod 0600 "$VELORAY_INSTALL_LOG"
 export VELORAY_INSTALL_LOG
 umask "$previous_mask"
}
vr_run() { "$@" >>"$VELORAY_INSTALL_LOG" 2>&1; }
vr_error() {
 local line="$1" status="${2:-1}"
 printf 'Failure: step=%s line=%s status=%s\n' "${VR_STEP:-operation}" "$line" "$status" >>"$VELORAY_INSTALL_LOG"
 vr_say "Failed: ${VR_STEP:-operation}." "مرحله ناموفق: ${VR_STEP:-عملیات}." >&2
 vr_say "Details: sudo tail -n 60 $VELORAY_INSTALL_LOG" "جزئیات: sudo tail -n 60 $VELORAY_INSTALL_LOG" >&2
 exit "$status"
}
vr_install_lock() {
 [[ "${VELORAY_INSTALL_LOCKED:-}" != true ]]||return 0
 exec 9>/run/lock/veloray-install.lock
 flock -n 9||{ vr_say 'Another VeloRay installation is running.' 'نصب دیگری از VeloRay در حال اجراست.' >&2;exit 1; }
 export VELORAY_INSTALL_LOCKED=true
}
vr_packages() {
 [[ "${VELORAY_DEPENDENCIES_READY:-}" != true ]]||return 0
 vr_run env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get update
 vr_run env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}
vr_xray_prepare() {
 # The service can traverse its config and write its standard logs under systemd protection.
 chmod 0755 /usr/local/etc/xray
 install -d -o nobody -g nogroup -m 0750 /var/log/xray
 find /var/log/xray -maxdepth 1 -type f -exec chown nobody:nogroup {} + -exec chmod 0640 {} +
 if [[ -n "${VELORAY_XRAY_DIRECTORY:-}" && ( ! -f /usr/local/share/xray/geoip.dat || ! -f /usr/local/share/xray/geosite.dat ) ]];then
  (cd "$VELORAY_XRAY_DIRECTORY" && sha256sum -c SHA256SUMS) >>"$VELORAY_INSTALL_LOG" 2>&1
  install -d -m 0755 /usr/local/share/xray
  install -m 0644 "$VELORAY_XRAY_DIRECTORY/geoip.dat" "$VELORAY_XRAY_DIRECTORY/geosite.dat" /usr/local/share/xray/
 fi
}
vr_xray_check() {
 local config=/usr/local/etc/xray/config.json
 chown root:nogroup "$config";chmod 0640 "$config"
 # TUN creation requires capabilities supplied by the actual service unit.
 if jq -e 'any(.inbounds[]?; .protocol == "tun")' "$config" >/dev/null 2>>"$VELORAY_INSTALL_LOG";then
  vr_run env XRAY_LOCATION_ASSET=/usr/local/share/xray /usr/local/bin/xray run -test -config "$config"
 else
  vr_run runuser -u nobody -- env XRAY_LOCATION_ASSET=/usr/local/share/xray /usr/local/bin/xray run -test -config "$config"
 fi
}
vr_diagnostics() {
 for unit in veloray-web.service veloray-agent.service xray.service;do
  systemctl --no-pager --full status "$unit" >>"$VELORAY_INSTALL_LOG" 2>&1||true
  journalctl -u "$unit" -n 40 --no-pager >>"$VELORAY_INSTALL_LOG" 2>&1||true
 done
}
vr_wait() {
 local path="$1" token="${2:-}" attempt body
 local -a headers=()
 [[ -z "$token" ]]||headers=(-H "Authorization: Bearer $token")
 for attempt in {1..45};do
  if body="$(curl -fsS --max-time 3 "${headers[@]}" "$path" 2>>"$VELORAY_INSTALL_LOG")";then
   if jq -e '.status=="ok" and (if has("xray") then .xray.installed==true and .xray.running==true else true end)' <<<"$body" >/dev/null 2>&1;then return 0;fi
  fi
  sleep 1
 done
 vr_diagnostics
 return 1
}
