#!/usr/bin/env bash
# with-me M0/M1 integration: build web + server, run real server, API smoke, then UI E2E.
# Usage: bash scripts/integrate.sh [--skip-ui]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/e/dev/tools/go1.27.3/go/bin:$PATH"
export GOCACHE=E:/dev/tmp/go-cache GOTMPDIR=E:/dev/tmp/go-tmp GOPATH=E:/dev/tmp/gopath GOPROXY=https://goproxy.cn,direct
export TEMP=E:/dev/tmp TMP=E:/dev/tmp TMPDIR=E:/dev/tmp
mkdir -p "$GOCACHE" "$GOTMPDIR" "$ROOT/bin"

SKIP_UI=0
[ "${1:-}" = "--skip-ui" ] && SKIP_UI=1

echo "== build web =="
(cd "$ROOT/web" && pnpm install --ignore-scripts && pnpm build)

echo "== build server =="
(cd "$ROOT/server" && go build -o "$ROOT/bin/withme.exe" ./cmd/withme)

DATA="$(mktemp -d "$TMP/withme-data-XXXXXX")"
echo "== start server (data=$DATA) =="
"$ROOT/bin/withme.exe" -addr 127.0.0.1:8080 -data "$DATA" -web "$ROOT/web/dist" >"$ROOT/bin/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 50); do
  if curl -s -o /dev/null http://127.0.0.1:8080/; then break; fi
  sleep 0.2
done

echo "== API smoke =="
node "$ROOT/e2e/api-smoke.mjs" http://127.0.0.1:8080

if [ "$SKIP_UI" = "0" ]; then
  echo "== UI E2E =="
  (cd "$ROOT/e2e" && pnpm test)
fi
echo "== integration done =="