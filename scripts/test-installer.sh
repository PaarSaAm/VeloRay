#!/usr/bin/env bash
# Offline bootstrap tests: all host commands and downloads use temporary fixtures.
set -Eeuo pipefail
project="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)";export TEST_ROOT
trap 'rm -rf -- "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/commands" "$TEST_ROOT/fixture/scripts" "$TEST_ROOT/fixture/frontend" "$TEST_ROOT/fixture/deploy/node"
printf 'ID=ubuntu\nVERSION_ID=24.04\n' >"$TEST_ROOT/os-release"
sed -e 's|source /etc/os-release|source "$TEST_ROOT/os-release"|' \
 -e '/^\[\[ ${EUID:/d' \
 -e 's|/opt/veloray/toolchains|$TEST_ROOT/toolchains|g' \
 -e 's|/usr/local/bin/xray|$TEST_ROOT/installed-xray|g' \
 "$project/install.sh" >"$TEST_ROOT/bootstrap.sh"
printf 'module test\ngo 1.26.0\n' >"$TEST_ROOT/fixture/go.mod"
printf '{}\n' >"$TEST_ROOT/fixture/frontend/package-lock.json"
cat >"$TEST_ROOT/fixture/scripts/build.sh" <<'BUILD'
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
mkdir -p "bin/linux-$1" frontend/dist
printf '#!/usr/bin/env bash\nexit 0\n' >"bin/linux-$1/veloray"
cp "bin/linux-$1/veloray" "bin/linux-$1/veloray-agent"
chmod +x "bin/linux-$1/"*
touch frontend/dist/index.html
echo "build=$1" >>"$TEST_ROOT/calls"
BUILD
cat >"$TEST_ROOT/fixture/scripts/install-panel.sh" <<'PANEL'
#!/usr/bin/env bash
test -f "$VELORAY_XRAY_ARCHIVE"
printf '%s  %s\n' "$VELORAY_XRAY_SHA256" "$VELORAY_XRAY_ARCHIVE" | sha256sum -c - >/dev/null
echo "panel=$VELORAY_INSTALL_LANG" >>"$TEST_ROOT/calls"
PANEL
sed 's/panel=/node=/' "$TEST_ROOT/fixture/scripts/install-panel.sh" >"$TEST_ROOT/fixture/deploy/node/install.sh"
tar -czf "$TEST_ROOT/source.tar.gz" -C "$TEST_ROOT" fixture
printf 'fixture-Xray-archive' >"$TEST_ROOT/xray.zip"
export TEST_XRAY_SHA="$(sha256sum "$TEST_ROOT/xray.zip" | cut -d' ' -f1)"
mkdir -p "$TEST_ROOT/go/bin" "$TEST_ROOT/node-v24.21.0-linux-arm64/bin"
printf '#!/usr/bin/env bash\necho "go version go1.27.2 linux/arm64"\n' >"$TEST_ROOT/go/bin/go"
printf '#!/usr/bin/env bash\necho v24.21.0\n' >"$TEST_ROOT/node-v24.21.0-linux-arm64/bin/node"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TEST_ROOT/node-v24.21.0-linux-arm64/bin/npm"
chmod +x "$TEST_ROOT/go/bin/go" "$TEST_ROOT/node-v24.21.0-linux-arm64/bin/"*
tar -czf "$TEST_ROOT/go.tar.gz" -C "$TEST_ROOT" go
tar -cJf "$TEST_ROOT/node.tar.xz" -C "$TEST_ROOT" node-v24.21.0-linux-arm64
export TEST_GO_SHA="$(sha256sum "$TEST_ROOT/go.tar.gz" | cut -d' ' -f1)" TEST_NODE_SHA="$(sha256sum "$TEST_ROOT/node.tar.xz" | cut -d' ' -f1)"
cat >"$TEST_ROOT/commands/curl" <<'CURL'
#!/usr/bin/env bash
set -e
url='';destination=''
while [[ $# -gt 0 ]];do case "$1" in -o) destination="$2";shift 2;;https://*) url="$1";shift;;*) shift;;esac;done
echo "$url" >>"$TEST_ROOT/requests"
case "$url" in
 https://go.dev/dl/\?mode=json) printf '[{"stable":true,"files":[{"os":"linux","arch":"arm64","kind":"archive","version":"go1.27.2","filename":"go1.27.2.linux-arm64.tar.gz","sha256":"%s"}]}]' "$TEST_GO_SHA" >"$destination";;
 https://go.dev/dl/go1.27.2.linux-arm64.tar.gz) if [[ "${TEST_BAD_GO_DIGEST:-}" == 1 ]];then printf broken >"$destination";else cp "$TEST_ROOT/go.tar.gz" "$destination";fi;;
 https://nodejs.org/dist/index.json) printf '[{"version":"v24.21.0","lts":"Krypton","files":["linux-arm64"]}]' >"$destination";;
 */SHASUMS256.txt) printf '%s  node-v24.21.0-linux-arm64.tar.xz\n' "$TEST_NODE_SHA" >"$destination";;
 */node-v24.21.0-linux-arm64.tar.xz) cp "$TEST_ROOT/node.tar.xz" "$destination";;
 */commits/*) printf '{"sha":"1111111111111111111111111111111111111111"}' >"$destination";;
 */tarball/*) cp "$TEST_ROOT/source.tar.gz" "$destination";;
 */XTLS/Xray-core/releases/latest) printf '{"tag_name":"v26.3.27","assets":[{"name":"Xray-linux-64.zip","digest":"sha256:%s"},{"name":"Xray-linux-arm64-v8a.zip","digest":"sha256:%s"}]}' "$TEST_XRAY_SHA" "$TEST_XRAY_SHA" >"$destination";;
 */releases/download/*) if [[ "${TEST_BAD_DIGEST:-}" == 1 ]];then printf broken >"$destination";else cp "$TEST_ROOT/xray.zip" "$destination";fi;;
 *) echo "Unexpected network request: $url" >&2;exit 2;;
esac
CURL
cat >"$TEST_ROOT/commands/apt-get" <<'APT'
#!/usr/bin/env bash
echo "apt=$*" >>"$TEST_ROOT/host-commands"
APT
cat >"$TEST_ROOT/commands/uname" <<'UNAME'
#!/usr/bin/env bash
echo "${TEST_MACHINE:-x86_64}"
UNAME
cat >"$TEST_ROOT/commands/go" <<'GO'
#!/usr/bin/env bash
if [[ "${TEST_OLD_TOOLS:-}" == 1 ]];then echo 'go version go1.25.0 linux/amd64';else echo 'go version go1.27.2 linux/amd64';fi
GO
cat >"$TEST_ROOT/commands/node" <<'NODE'
#!/usr/bin/env bash
if [[ "${TEST_OLD_TOOLS:-}" == 1 ]];then echo v20.0.0;else echo v24.21.0;fi
NODE
printf '#!/usr/bin/env bash\nexit 0\n' >"$TEST_ROOT/commands/npm"
chmod +x "$TEST_ROOT/commands/"*
export PATH="$TEST_ROOT/commands:$PATH" VELORAY_PUBLIC_HOST=panel.example.com VELORAY_ADMIN_PASSWORD=test-only-password
unset VELORAY_XRAY_ARCHIVE VELORAY_XRAY_SHA256 VELORAY_REPO VELORAY_REF || true
passed=0
pass() { passed=$((passed+1));printf 'PASS %s\n' "$1"; }
reject() {
 local phrase="$1";shift
 if bash "$project/install.sh" "$@" >"$TEST_ROOT/result" 2>&1;then echo 'Invalid arguments accepted' >&2;exit 1;fi
 grep -Fq "$phrase" "$TEST_ROOT/result";pass "$phrase"
}
bash "$project/install.sh" --help >"$TEST_ROOT/result"
grep -Fq -- '--database postgresql' "$TEST_ROOT/result";pass help
reject 'Only PostgreSQL' install --database mysql
reject 'Missing value' --database
reject 'Language must' --lang xx
reject 'Invalid repository' --repo ../bad
reject 'Unknown argument' --unavailable
for machine in x86_64 aarch64;do
 export TEST_MACHINE="$machine"
 for mode in install node;do
  : >"$TEST_ROOT/calls"
  # bash -c matches the documented curl command; @ supplies $0.
  bash -c "$(cat "$TEST_ROOT/bootstrap.sh")" @ "$mode" --database postgresql --lang fa >"$TEST_ROOT/result" 2>&1
  expected=panel;[[ "$mode" != node ]]||expected=node
  grep -Fq "$expected=fa" "$TEST_ROOT/calls"
  grep -Fq '/tarball/1111111111111111111111111111111111111111' "$TEST_ROOT/requests"
  pass "$mode/$machine"
 done
done
cat "$TEST_ROOT/bootstrap.sh" | bash -s -- install --lang en >"$TEST_ROOT/result" 2>&1
grep -Fq 'panel=en' "$TEST_ROOT/calls";pass piped-install
export TEST_OLD_TOOLS=1
bash -c "$(cat "$TEST_ROOT/bootstrap.sh")" @ install >"$TEST_ROOT/result" 2>&1
test -x "$TEST_ROOT/toolchains/go1.27.2/go/bin/go"
test -x "$TEST_ROOT/toolchains/node-v24.21.0-linux-arm64/bin/node"
pass build-tool-downloads
export TEST_BAD_GO_DIGEST=1
if bash -c "$(cat "$TEST_ROOT/bootstrap.sh")" @ install >"$TEST_ROOT/result" 2>&1;then echo 'Bad Go checksum accepted' >&2;exit 1;fi
grep -Fq 'checksum mismatch' "$TEST_ROOT/result";pass build-tool-checksum-rejection
unset TEST_OLD_TOOLS TEST_BAD_GO_DIGEST
export TEST_BAD_DIGEST=1
if bash -c "$(cat "$TEST_ROOT/bootstrap.sh")" @ install >"$TEST_ROOT/result" 2>&1;then echo 'Bad checksum accepted' >&2;exit 1;fi
grep -Fq 'checksum mismatch' "$TEST_ROOT/result";pass checksum-rejection
unset TEST_BAD_DIGEST
ln -s /etc/passwd "$TEST_ROOT/fixture/unsafe-link"
tar -czf "$TEST_ROOT/source.tar.gz" -C "$TEST_ROOT" fixture
if bash -c "$(cat "$TEST_ROOT/bootstrap.sh")" @ install >"$TEST_ROOT/result" 2>&1;then echo 'Unsafe archive accepted' >&2;exit 1;fi
grep -Fq 'links or special files' "$TEST_ROOT/result";pass archive-link-rejection
printf '%s installer checks passed.\n' "$passed"
