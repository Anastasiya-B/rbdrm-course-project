#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
  cd "$(dirname "$0")/.." &&
  pwd
)"

LOG_FILE="$(mktemp)"
API_PID=""

export PORT="${DEMO_METRICS_PORT:-3011}"
export API_URL="http://127.0.0.1:${PORT}"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi

  rm -f "$LOG_FILE"
}

trap cleanup EXIT INT TERM

cd "$ROOT"

node dist/main.js \
  >"$LOG_FILE" \
  2>&1 &

API_PID=$!

READY=0

for _ in $(seq 1 80); do
  if ! kill -0 "$API_PID" >/dev/null 2>&1; then
    echo "API process exited during startup" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi

  if curl -fsS \
    "${API_URL}/healthz" \
    >/dev/null 2>&1
  then
    READY=1
    break
  fi

  sleep 0.25
done

if [[ "$READY" -ne 1 ]]; then
  echo "API failed to become ready" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

node demo/demo-metrics.mjs