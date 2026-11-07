#!/usr/bin/env bash
# Start with-me from any working directory. Foreground; Ctrl+C stops.
# Overrides: ADDR (default 127.0.0.1:8080), DATA (default <repo>/data), GO_BIN, GOCACHE/GOTMPDIR/GOPATH.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v go >/dev/null 2>&1; then
  export PATH="${GO_BIN:-/e/dev/tools/go1.27.3/go/bin}:$PATH"
fi
export GOCACHE="${GOCACHE:-E:/dev/tmp/go-cache}" GOTMPDIR="${GOTMPDIR:-E:/dev/tmp/go-tmp}" GOPATH="${GOPATH:-E:/dev/tmp/gopath}"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
export TEMP="${TEMP:-E:/dev/tmp}" TMP="${TMP:-E:/dev/tmp}" TMPDIR="${TMPDIR:-E:/dev/tmp}"
mkdir -p "$GOCACHE" "$GOTMPDIR" "$GOPATH" "$ROOT/bin"

if [ ! -f "$ROOT/web/dist/index.html" ]; then
  (cd "$ROOT/web" && pnpm install --ignore-scripts && pnpm build)
fi
(cd "$ROOT/server" && go build -o "$ROOT/bin/withme.exe" ./cmd/withme)

echo "with-me listening on ${ADDR:-127.0.0.1:8080} (data=${DATA:-$ROOT/data})"
exec "$ROOT/bin/withme.exe" -addr "${ADDR:-127.0.0.1:8080}" -data "${DATA:-$ROOT/data}" -web "$ROOT/web/dist"