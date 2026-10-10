#!/usr/bin/env bash
# Read-only release verification: no package installation or service changes.
set -Eeuo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."
case "${1:-all}" in
 all) architectures=(amd64 arm64);;
 amd64|arm64) architectures=("$1");;
 *) echo 'Usage: scripts/verify-runtime.sh [all|amd64|arm64]' >&2;exit 2;;
esac
[[ $# -le 1 ]]||{ echo 'Too many arguments.' >&2;exit 2; }
temporary="$(mktemp -d)";trap 'rm -rf -- "$temporary"' EXIT
bash scripts/build-runtime.sh --manifest >"$temporary/current-source.SHA256SUMS"
for arch in "${architectures[@]}";do
 archive="runtime/linux-$arch.tar.xz"
 checksum="$(awk -v name="linux-$arch.tar.xz" '$2==name {print $1}' runtime/SHA256SUMS)"
 [[ "$checksum" =~ ^[a-f0-9]{64}$ ]]||{ echo "Missing runtime checksum for $arch." >&2;exit 1; }
 printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
 tar -tf "$archive" >"$temporary/members"
 if awk '/(^\/|(^|\/)\.\.($|\/))/ {bad=1} END {exit !bad}' "$temporary/members";then echo 'Unsafe runtime archive paths.' >&2;exit 1;fi
 tar -tvf "$archive" >"$temporary/types"
 if awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit !bad}' "$temporary/types";then echo 'Runtime archive contains links or special files.' >&2;exit 1;fi
 bundle="$temporary/$arch";mkdir -p "$bundle"
 tar --no-same-owner --no-same-permissions -xf "$archive" -C "$bundle"
 if ! cmp -s "$temporary/current-source.SHA256SUMS" "$bundle/source.SHA256SUMS";then
  echo "Runtime source mismatch for $arch. Rebuild the runtime before publishing." >&2
  diff -u "$bundle/source.SHA256SUMS" "$temporary/current-source.SHA256SUMS" >&2 || true
  exit 1
 fi
 [[ -x "$bundle/bin/linux-$arch/veloray" && -x "$bundle/bin/linux-$arch/veloray-agent" && -f "$bundle/frontend/dist/index.html" && -x "$bundle/xray/xray" ]]||{ echo "Incomplete runtime for $arch." >&2;exit 1; }
 # Fonts, licenses and other public assets must be present in the built panel.
 while IFS= read -r -d '' public;do
  cmp -s "$public" "$bundle/frontend/dist/${public#frontend/public/}"||{ echo "Missing or changed public asset in $arch runtime: $public" >&2;exit 1; }
 done < <(find frontend/public -type f -print0)
 (cd "$bundle/bin/linux-$arch" && sha256sum -c SHA256SUMS)
 (cd "$bundle/xray" && sha256sum -c SHA256SUMS)
 echo "Verified $arch runtime matches the extracted source."
done
