#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMESPACE="${NAMESPACE:-marketplace-hw28}"
DEPLOYMENT="${DEPLOYMENT:-marketplace-deployment}"
TARGET_URL="${TARGET_URL:-http://127.0.0.1:30080/healthz}"

MIN_REQUESTS="${MIN_REQUESTS:-5000}"
CONCURRENCY="${CONCURRENCY:-8}"
PULUMI_TIMEOUT_SECONDS="${PULUMI_TIMEOUT_SECONDS:-180}"

EVIDENCE_FILE="${EVIDENCE_FILE:-/tmp/hw28-rollout-http-codes.txt}"

TMP_DIR="$(mktemp -d)"

STOP_FILE="$TMP_DIR/stop"
PULUMI_LOG="$TMP_DIR/pulumi.log"
PULUMI_STATUS_FILE="$TMP_DIR/pulumi-status"

LOAD_PID=""
PULUMI_PID=""
PULUMI_ACTIVE=0

cancel_pulumi_update() {
  (
    cd "$ROOT/infra"

    npx pulumi cancel \
      --yes \
      >/dev/null 2>&1 ||
      true
  )
}

cleanup() {
  if [[ -n "${LOAD_PID:-}" ]]; then
    kill "$LOAD_PID" \
      >/dev/null 2>&1 ||
      true

    wait "$LOAD_PID" \
      >/dev/null 2>&1 ||
      true
  fi

  if [[ "$PULUMI_ACTIVE" -eq 1 ]]; then
    if [[ -n "${PULUMI_PID:-}" ]]; then
      kill "$PULUMI_PID" \
        >/dev/null 2>&1 ||
        true

      wait "$PULUMI_PID" \
        >/dev/null 2>&1 ||
        true
    fi

    cancel_pulumi_update
  fi

  rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

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

rm -f \
  "$STOP_FILE" \
  "$PULUMI_STATUS_FILE" \
  "$EVIDENCE_FILE"

TARGET_URL="$TARGET_URL" \
STOP_FILE="$STOP_FILE" \
CODE_FILE="$EVIDENCE_FILE" \
MIN_REQUESTS="$MIN_REQUESTS" \
CONCURRENCY="$CONCURRENCY" \
node "$ROOT/demo/rollout-load.mjs" &

LOAD_PID="$!"

sleep 1

START_SECONDS="$(date +%s)"
REV="hw28-$(date +%s)"

echo "Starting rollout revision: $REV"

(
  set +e

  REV="$REV" \
    npm run up \
    > >(tee "$PULUMI_LOG") \
    2>&1

  echo "$?" >"$PULUMI_STATUS_FILE"
) &

PULUMI_PID="$!"
PULUMI_ACTIVE=1

while kill -0 "$PULUMI_PID" >/dev/null 2>&1; do
  NOW="$(date +%s)"
  ELAPSED=$((NOW - START_SECONDS))

  if [[ "$ELAPSED" -ge "$PULUMI_TIMEOUT_SECONDS" ]]; then
    echo "Pulumi rollout timed out after ${PULUMI_TIMEOUT_SECONDS}s" >&2

    kill "$PULUMI_PID" \
      >/dev/null 2>&1 ||
      true

    wait "$PULUMI_PID" \
      >/dev/null 2>&1 ||
      true

    cancel_pulumi_update

    PULUMI_ACTIVE=0
    PULUMI_PID=""

    touch "$STOP_FILE"

    wait "$LOAD_PID" \
      >/dev/null 2>&1 ||
      true

    LOAD_PID=""

    exit 1
  fi

  sleep 1
done

wait "$PULUMI_PID" \
  >/dev/null 2>&1 ||
  true

PULUMI_ACTIVE=0
PULUMI_PID=""

if [[ ! -f "$PULUMI_STATUS_FILE" ]]; then
  echo "Pulumi status was not recorded" >&2
  cancel_pulumi_update
  exit 1
fi

PULUMI_STATUS="$(cat "$PULUMI_STATUS_FILE")"

if [[ "$PULUMI_STATUS" -ne 0 ]]; then
  echo "Pulumi rollout failed with exit code $PULUMI_STATUS" >&2
  exit 1
fi

if ! kubectl \
  -n "$NAMESPACE" \
  rollout status \
  deployment/"$DEPLOYMENT" \
  --timeout=60s; then
  echo "Kubernetes rollout did not complete successfully" >&2
  exit 1
fi

END_SECONDS="$(date +%s)"

touch "$STOP_FILE"

wait "$LOAD_PID"
LOAD_PID=""

if [[ ! -f "$EVIDENCE_FILE" ]]; then
  echo "HTTP evidence file was not created" >&2
  exit 1
fi

REQUESTS="$(
  awk '
    NF {
      count += 1
    }

    END {
      print count + 0
    }
  ' "$EVIDENCE_FILE"
)"

OK="$(
  awk '
    $1 == 200 {
      count += 1
    }

    END {
      print count + 0
    }
  ' "$EVIDENCE_FILE"
)"

FAILED="$(
  awk '
    $1 != 200 {
      count += 1
    }

    END {
      print count + 0
    }
  ' "$EVIDENCE_FILE"
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
  echo "Failed HTTP codes:" >&2

  awk '
    $1 != 200 {
      print
    }
  ' "$EVIDENCE_FILE" \
    | sort \
    | uniq -c \
    >&2

  exit 1
fi

if [[ "$OK" -ne "$REQUESTS" ]]; then
  echo "Successful response count does not match total requests" >&2
  exit 1
fi