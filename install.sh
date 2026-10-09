#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'VeloRay: %s\n' "$*" >&2; exit 1; }
usage() {
 cat <<'HELP'
VeloRay installer
  install.sh [install|node] [--database postgresql] [--lang en|fa]
             [--repo OWNER/REPOSITORY] [--ref BRANCH_OR_TAG_OR_COMMIT]
PostgreSQL is the supported database. Default repository: PaarSaAm/VeloRay, ref: main.
HELP
}
version_at_least() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }
fetch() { curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --connect-timeout 15 --max-time 600 "$1" -o "$2"; }
verify() {
 [[ "$1" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Missing or invalid SHA-256 checksum.'
 printf '%s  %s\n' "$1" "$2" | sha256sum -c - >/dev/null || fail 'Download checksum mismatch.'
}

action=install
database=postgresql
language=en
repository="${VELORAY_REPO:-PaarSaAm/VeloRay}"
reference="${VELORAY_REF:-main}"
if [[ "${1:-}" == install || "${1:-}" == node ]];then action="$1";shift;fi
while [[ $# -gt 0 ]];do
 case "$1" in
  --help|-h) usage;exit 0;;
  --database|--lang|--repo|--ref)
   [[ $# -ge 2 && -n "$2" && "$2" != --* ]]||fail "Missing value for $1."
   case "$1" in --database) database="$2";;--lang) language="$2";;--repo) repository="$2";;--ref) reference="$2";;esac
   shift 2;;
  *) fail "Unknown argument: $1. Run install.sh --help.";;
 esac
done
[[ "$database" == postgresql ]]||fail 'Only PostgreSQL is supported; SQLite, MySQL, MariaDB and TimescaleDB options are unavailable.'
[[ "$language" == en || "$language" == fa ]]||fail 'Language must be en or fa.'
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "$repository" != *..* ]]||fail 'Invalid repository name.'
[[ "$reference" =~ ^[A-Za-z0-9_.-]+$ && "$reference" != *..* ]]||fail 'Invalid ref; use a simple branch, tag or full commit SHA.'
[[ ${EUID:-$(id -u)} -eq 0 ]]||fail 'Run the installer with sudo.'
[[ -r /etc/os-release ]]||fail 'Cannot identify the operating system.'
source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]]||fail 'This installer supports Ubuntu 24.04.'
case "$(uname -m)" in x86_64) arch=amd64;node_arch=x64;xray_asset=Xray-linux-64.zip;;aarch64|arm64) arch=arm64;node_arch=arm64;xray_asset=Xray-linux-arm64-v8a.zip;;*) fail 'Unsupported CPU architecture.';;esac

temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT
trap 'printf "VeloRay installation failed at line %s.\n" "$LINENO" >&2' ERR
apt-get update
apt-get install -y ca-certificates curl jq tar xz-utils unzip openssl

source_directory=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]];then
 source_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi
if [[ -z "$source_directory" || ! -f "$source_directory/go.mod" || ! -f "$source_directory/scripts/install-panel.sh" ]];then
 fetch "https://api.github.com/repos/$repository/commits/$reference" "$temporary/commit.json"
 commit="$(jq -er '.sha' "$temporary/commit.json")"
 [[ "$commit" =~ ^[a-f0-9]{40}$ ]]||fail 'GitHub did not return a valid source commit.'
 printf 'Downloading %s at %s\n' "$repository" "$commit"
 fetch "https://api.github.com/repos/$repository/tarball/$commit" "$temporary/source.tar.gz"
 # GitHub archives contain regular files/directories; reject links and traversal before extracting.
 tar -tzf "$temporary/source.tar.gz" >"$temporary/members"
 if awk '/(^\/|(^|\/)\.\.($|\/))/ {bad=1} END {exit !bad}' "$temporary/members";then fail 'Unsafe source archive paths.';fi
 tar -tvzf "$temporary/source.tar.gz" >"$temporary/types"
 if awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit !bad}' "$temporary/types";then fail 'Source archive contains links or special files.';fi
 source_directory="$temporary/source"
 mkdir -p "$source_directory"
 tar --no-same-owner --no-same-permissions -xzf "$temporary/source.tar.gz" -C "$source_directory" --strip-components=1
fi
[[ -f "$source_directory/go.mod" && -f "$source_directory/frontend/package-lock.json" && -f "$source_directory/scripts/install-panel.sh" ]]||fail 'The selected repository does not contain a complete VeloRay project.'

prepare_build_tools() {
 local current minimum descriptor filename checksum target version
 minimum="$(awk '$1=="go" {print $2;exit}' "$source_directory/go.mod")"
 [[ "$minimum" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]||fail 'Invalid Go requirement in go.mod.'
 current="$(go version 2>/dev/null | awk '{sub(/^go/,"",$3);print $3}')"||current=""
 if [[ -z "$current" ]]||! version_at_least "$current" "$minimum";then
  fetch 'https://go.dev/dl/?mode=json' "$temporary/go.json"
  descriptor="$(jq -ce --arg arch "$arch" '[.[]|select(.stable==true)|.files[]|select(.os=="linux" and .arch==$arch and .kind=="archive")][0]' "$temporary/go.json")"
  version="$(jq -er '.version' <<<"$descriptor")";filename="$(jq -er '.filename' <<<"$descriptor")";checksum="$(jq -er '.sha256' <<<"$descriptor")"
  [[ "$version" =~ ^go[0-9]+\.[0-9]+\.[0-9]+$ && "$filename" == "$version.linux-$arch.tar.gz" ]]||fail 'Unexpected Go download metadata.'
  version_at_least "${version#go}" "$minimum"||fail 'The available Go compiler is too old.'
  fetch "https://go.dev/dl/$filename" "$temporary/go.tar.gz";verify "$checksum" "$temporary/go.tar.gz"
  target="/opt/veloray/toolchains/$version";mkdir -p "$target"
  tar --no-same-owner -xzf "$temporary/go.tar.gz" -C "$target"
  export PATH="$target/go/bin:$PATH"
 fi
 current="$(node --version 2>/dev/null)"||current=""
 if [[ -z "$current" ]]||! version_at_least "${current#v}" 22.12.0||! command -v npm >/dev/null;then
  fetch 'https://nodejs.org/dist/index.json' "$temporary/node.json"
  version="$(jq -er --arg arch "linux-$node_arch" '[.[]|select(.lts!=false and (.files|index($arch))!=null)|select((.version|ltrimstr("v")|split(".")[0]|tonumber)>=22)][0].version' "$temporary/node.json")"
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]||fail 'Unexpected Node.js download metadata.'
  filename="node-$version-linux-$node_arch.tar.xz"
  fetch "https://nodejs.org/dist/$version/SHASUMS256.txt" "$temporary/node.sums"
  checksum="$(awk -v name="$filename" '$2==name {print $1}' "$temporary/node.sums")"
  fetch "https://nodejs.org/dist/$version/$filename" "$temporary/node.tar.xz";verify "$checksum" "$temporary/node.tar.xz"
  target=/opt/veloray/toolchains;mkdir -p "$target"
  tar --no-same-owner -xJf "$temporary/node.tar.xz" -C "$target"
  export PATH="$target/node-$version-linux-$node_arch/bin:$PATH"
 fi
}

if [[ ! -x "$source_directory/bin/linux-$arch/veloray-agent" || ! -x "$source_directory/bin/linux-$arch/veloray" || ! -f "$source_directory/frontend/dist/index.html" ]];then
 prepare_build_tools
 bash "$source_directory/scripts/build.sh" "$arch"
fi

if [[ ! -x /usr/local/bin/xray && -z "${VELORAY_XRAY_ARCHIVE:-}" ]];then
 xray_version="${VELORAY_XRAY_VERSION:-latest}"
 if [[ "$xray_version" == latest ]];then release_url=https://api.github.com/repos/XTLS/Xray-core/releases/latest
 else [[ "$xray_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]||fail 'Invalid Xray version.';release_url="https://api.github.com/repos/XTLS/Xray-core/releases/tags/$xray_version";fi
 fetch "$release_url" "$temporary/xray.json"
 xray_version="$(jq -er '.tag_name' "$temporary/xray.json")"
 [[ "$xray_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]||fail 'Unexpected Xray release metadata.'
 digest="$(jq -er --arg name "$xray_asset" '.assets[]|select(.name==$name)|.digest' "$temporary/xray.json")"
 [[ "$digest" == sha256:* ]]||fail 'The Xray release is missing a SHA-256 asset digest.'
 export VELORAY_XRAY_ARCHIVE="$temporary/$xray_asset" VELORAY_XRAY_SHA256="${digest#sha256:}"
 fetch "https://github.com/XTLS/Xray-core/releases/download/$xray_version/$xray_asset" "$VELORAY_XRAY_ARCHIVE"
 verify "$VELORAY_XRAY_SHA256" "$VELORAY_XRAY_ARCHIVE"
fi
export VELORAY_INSTALL_LANG="$language"
installer="$source_directory/scripts/install-panel.sh"
[[ "$action" != node ]]||installer="$source_directory/deploy/node/install.sh"
# Piped invocations reserve stdin for the script; prompts must use the terminal.
if { true </dev/tty; } 2>/dev/null;then bash "$installer" </dev/tty
else
 [[ -n "${VELORAY_PUBLIC_HOST:-}" ]]||fail 'No terminal: set VELORAY_PUBLIC_HOST for unattended installation.'
 if [[ "$action" == install && ! -f /etc/veloray/veloray.env && -z "${VELORAY_ADMIN_PASSWORD:-}" ]];then fail 'No terminal: set VELORAY_ADMIN_PASSWORD.';fi
 bash "$installer"
fi
