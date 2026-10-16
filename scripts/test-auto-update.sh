#!/usr/bin/env bash
# Unit checks for the side-effect-free GitHub update-check path.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
source scripts/auto-update.sh

TEST_HOME="$(mktemp -d)"
trap 'rm -rf -- "$TEST_HOME"' EXIT
commit=1111111111111111111111111111111111111111
installed="$TEST_HOME/installed"
mode=success
calls=0

vr_auto_download() {
 local url="$1" output="$2"
 calls=$((calls + 1))
 case "$url" in
  */commits/main)
   if [[ "$mode" == outage ]];then return 22;fi
   printf '{"sha":"%s"}\n' "$commit" >"$output"
   ;;
  */actions/workflows/ci.yml/runs*)
   printf '{"workflow_runs":[{"head_sha":"%s","status":"completed","conclusion":"%s"}]}\n' "$commit" "$mode" >"$output"
   ;;
  *) echo "Unexpected GitHub endpoint: $url" >&2;return 1;;
 esac
}

pass=0
expect() {
 local phrase="$1" output="$2"
 [[ "$output" == *"$phrase"* ]] || { echo "Expected '$phrase' in $output" >&2;exit 1; }
 pass=$((pass + 1))
}

printf '%s\n' "$commit" >"$installed"
output="$(vr_auto_update_check check ParsaZali/VeloRay "$installed")"
expect 'Already up to date' "$output"

printf '%s\n' 0000000000000000000000000000000000000000 >"$installed"
output="$(vr_auto_update_check check ParsaZali/VeloRay "$installed")"
expect 'Verified GitHub update available' "$output"

mode=failure
output="$(vr_auto_update_check check ParsaZali/VeloRay "$installed")"
expect 'skipping unsafe update' "$output"

mode=outage
if vr_auto_update_check check ParsaZali/VeloRay "$installed" >"$TEST_HOME/output" 2>&1;then
 echo 'Network outage was incorrectly treated as a safe update.' >&2
 exit 1
fi
expect 'Could not reach GitHub' "$(cat "$TEST_HOME/output")"

echo "$pass automatic update checks passed"
