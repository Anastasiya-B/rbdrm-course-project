#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMESPACE="${NAMESPACE:-marketplace-hw28}"
DEPLOYMENT="${DEPLOYMENT:-marketplace-deployment}"
TARGET_URL="${TARGET_URL:-http://127.0.0.1:30080/healthz}"
MIN_REQUESTS="${MIN_REQUESTS:-5000}"
CONCURRENCY="${CONCURRENCY:-32}"

TMP_DIR="$(mktemp -d)"

STOP_FILE="$TMP_DIR/stop"
RESULT_FILE="$TMP_DIR/result.json"
PULUMI_LOG="$TMP_DIR/pulumi.log"

LOAD_PID=""

cleanup() {
  if [[ -n "${LOAD_PID:-}" ]]; then
    kill "$LOAD_PID" >/dev/null 2>&1 || true
  fi

  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

cd "$ROOT"

if ! kubectl \
  -n "$NAMESPACE" \
  get deployment "$DEPLOYMENT" \
  >/dev/null 2>&1; then
  echo "Deployment $DEPLOYMENT not found in namespace $NAMESPACE" >&2
  exit 1
fi

if ! curl \
  --fail \
  --silent \
  --show-error \
  "$TARGET_URL" \
  >/dev/null; then
  echo "Target is not healthy before rollout: $TARGET_URL" >&2
  exit 1
fi

rm -f "$STOP_FILE" "$RESULT_FILE"

TARGET_URL="$TARGET_URL" \
STOP_FILE="$STOP_FILE" \
RESULT_FILE="$RESULT_FILE" \
MIN_REQUESTS="$MIN_REQUESTS" \
CONCURRENCY="$CONCURRENCY" \
node "$ROOT/demo/rollout-load.mjs" &

LOAD_PID="$!"

sleep 1

START_SECONDS="$(date +%s)"
REV="hw28-$(date +%s)"

if ! REV="$REV" npm run up >"$PULUMI_LOG" 2>&1; then
  touch "$STOP_FILE"

  wait "$LOAD_PID" || true
  LOAD_PID=""

  cat "$PULUMI_LOG" >&2
  echo "Rollout failed" >&2

  exit 1
fi

if ! kubectl \
  -n "$NAMESPACE" \
  rollout status \
  deployment/"$DEPLOYMENT" \
  --timeout=180s \
  >/dev/null; then
  touch "$STOP_FILE"

  wait "$LOAD_PID" || true
  LOAD_PID=""

  echo "Kubernetes rollout did not complete successfully" >&2

  exit 1
fi

END_SECONDS="$(date +%s)"

touch "$STOP_FILE"

wait "$LOAD_PID"
LOAD_PID=""

if [[ ! -f "$RESULT_FILE" ]]; then
  echo "Load result file was not created" >&2
  exit 1
fi

REQUESTS="$(
  node -e "
    const fs = require('node:fs');
    const result = JSON.parse(
      fs.readFileSync(process.argv[1], 'utf8')
    );
    process.stdout.write(String(result.requests));
  " "$RESULT_FILE"
)"

OK="$(
  node -e "
    const fs = require('node:fs');
    const result = JSON.parse(
      fs.readFileSync(process.argv[1], 'utf8')
    );
    process.stdout.write(String(result.ok));
  " "$RESULT_FILE"
)"

FAILED="$(
  node -e "
    const fs = require('node:fs');
    const result = JSON.parse(
      fs.readFileSync(process.argv[1], 'utf8')
    );
    process.stdout.write(String(result.failed));
  " "$RESULT_FILE"
)"

ROLLOUT_SECONDS=$((END_SECONDS - START_SECONDS))

echo "profile=correct"
echo "requests=$REQUESTS"
echo "ok=$OK"
echo "failed=$FAILED"
echo "rollout-seconds=$ROLLOUT_SECONDS"

if [[ "$REQUESTS" -lt "$MIN_REQUESTS" ]]; then
  echo "Expected at least $MIN_REQUESTS requests" >&2
  exit 1
fi

if [[ "$FAILED" -ne 0 ]]; then
  echo "Zero-downtime requirement failed" >&2
  exit 1
fi

if [[ "$OK" -ne "$REQUESTS" ]]; then
  echo "Successful response count does not match total requests" >&2
  exit 1
fi