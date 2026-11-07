#!/usr/bin/env bash
# 打 fnOS 原生应用包（native .fpk）：前端构建 + linux/amd64 静态二进制 + packaging/ 定义 → dist/。
#
# 用法:
#   bash scripts/build-fpk.sh             # 出包：dist/with-me-<版本>.fpk（外加稳定名 dist/with-me.fpk）
#   bash scripts/build-fpk.sh --check     # 只体检 packaging/（版本、端口对账、行尾），不编译不出包
#   PKG_VERSION=1.0.3 bash scripts/build-fpk.sh    # 临时指定包版本
#
# 版本正本是 packaging/manifest 的 version。应用中心同版本拒更新，发新包前记得抬版本。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP=with-me
PKG="$ROOT/packaging"
STAGE="$ROOT/dist/.stage/$APP"
DIST="$ROOT/dist"

CHECK_ONLY=0
case "${1:-}" in
  --check) CHECK_ONLY=1 ;;
  "") ;;
  *) echo "未知参数：$1（只支持 --check）" >&2; exit 2 ;;
esac

die() { echo "错误：$*" >&2; exit 1; }
[ -d "$PKG" ] || die "缺 packaging/ 目录"

# —— 体检：版本 ——
ver=$(sed -n 's/^version[[:space:]]*=[[:space:]]*//p' "$PKG/manifest" | tr -d '[:space:]')
ver="${PKG_VERSION:-$ver}"
printf '%s' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || die "版本号 '$ver' 不是 fnpack 要求的 X.Y.Z"

# —— 体检：端口三方对账（改端口时三处一起改，漏一处就是图标点开 404）——
port_manifest=$(sed -n 's/^service_port[[:space:]]*=[[:space:]]*//p' "$PKG/manifest" | tr -d '[:space:]')
port_runtime=$(sed -n 's/.*TRIM_SERVICE_PORT:-\([0-9][0-9]*\).*/\1/p' "$PKG/app/runtime.sh" | head -1)
port_ui=$(sed -n 's/.*"port": *"\([0-9][0-9]*\)".*/\1/p' "$PKG/app/ui/config" | head -1)
[ -n "$port_runtime" ] && [ -n "$port_ui" ] \
  || die "读不到端口（app/runtime.sh 的 TRIM_SERVICE_PORT / app/ui/config 的 port）"
[ "$port_manifest" = "$port_runtime" ] && [ "$port_ui" = "$port_runtime" ] \
  || die "端口不一致：manifest=${port_manifest:-?} runtime.sh=$port_runtime ui/config=$port_ui"

# —— 体检：fnOS 交给 bash 解析的文件必须 LF（PNG 里的 0x0D 是二进制内容，不在清单内）——
for f in "$PKG"/manifest "$PKG"/app/runtime.sh "$PKG/app/ui/config" \
         "$PKG"/config/* "$PKG"/cmd/* "$PKG"/wizard/*; do
  [ -f "$f" ] || continue
  if grep -q "$(printf '\r')" "$f"; then
    die "CRLF 行尾：${f#"$ROOT"/}（fnOS 用 bash 跑会在 shebang 处失败）"
  fi
done
echo "体检通过：版本 $ver，端口 $port_runtime，行尾 LF"

if [ "$CHECK_ONLY" = 1 ]; then
  echo "（--check：只体检，不编译不出包）"
  exit 0
fi

# —— 1. 前端 ——
cd "$ROOT/web"
[ -d node_modules ] || pnpm install --ignore-scripts
pnpm build

# —— 2. 后端：linux/amd64 纯静态（NAS 上没有 Go 工具链，必须在这台机器编好）——
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    command -v go >/dev/null 2>&1 || export PATH="${GO_BIN:-/e/dev/tools/go1.27.3/go/bin}:$PATH"
    export GOCACHE="${GOCACHE:-E:/dev/tmp/go-cache}"
    export GOTMPDIR="${GOTMPDIR:-E:/dev/tmp/go-tmp}"
    export GOPATH="${GOPATH:-E:/dev/tmp/gopath}"
    export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
    ;;
esac
command -v go >/dev/null 2>&1 || die "找不到 go（Windows 默认 /e/dev/tools/go1.27.3/go/bin，可用 GO_BIN 覆盖）"
mkdir -p "$ROOT/bin"
(cd "$ROOT/server" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o "$ROOT/bin/withme-linux" ./cmd/withme)

# —— 3. 组装：packaging/ 是包定义正本，二进制与前端产物现填 ——
rm -rf "$STAGE"
mkdir -p "$STAGE/app"
cp -R "$PKG/." "$STAGE/"
sed -i "s/^version[[:space:]]*=.*/version               = $ver/" "$STAGE/manifest"
cp -f "$ROOT/bin/withme-linux" "$STAGE/app/withme"
cp -R "$ROOT/web/dist" "$STAGE/app/dist"

# —— 4. 出包 ——
command -v fnpack >/dev/null 2>&1 || die "找不到 fnpack（装在 PATH 里即可）"
( cd "$ROOT/dist/.stage" && fnpack build -d "$APP" ) >/dev/null
mkdir -p "$DIST"
cp -f "$ROOT/dist/.stage/$APP.fpk" "$DIST/$APP-$ver.fpk"
cp -f "$DIST/$APP-$ver.fpk" "$DIST/$APP.fpk"
rm -rf "$ROOT/dist/.stage"

echo "完成：dist/$APP-$ver.fpk（$(du -h "$DIST/$APP-$ver.fpk" | cut -f1)，端口 $port_runtime）"
echo "sha256：$(sha256sum "$DIST/$APP-$ver.fpk" | cut -d' ' -f1)"
