#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.."
  pwd
)"

PULUMI_DIR="$ROOT/.pulumi"
STACK_NAME="${PULUMI_STACK_NAME:-dev}"

mkdir -p "$PULUMI_DIR"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$PULUMI_DIR}"

cd "$ROOT/infra"

npx pulumi login "$PULUMI_BACKEND_URL" >/dev/null

if ! npx pulumi stack select "$STACK_NAME" >/dev/null 2>&1; then
  npx pulumi stack init "$STACK_NAME"
fi

set +e

npx pulumi up \
  --stack "$STACK_NAME" \
  --yes \
  --non-interactive

STATUS="$?"

set -e

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "=== Kubernetes diagnostics ==="

  kubectl \
    -n marketplace-hw28 \
    get pods \
    -o wide \
    || true

  echo
  echo "=== Pod descriptions ==="

  kubectl \
    -n marketplace-hw28 \
    describe pods \
    || true

  echo
  echo "=== Current container logs ==="

  for pod in $(
    kubectl \
      -n marketplace-hw28 \
      get pods \
      -l app=marketplace \
      -o name \
      2>/dev/null
  ); do
    echo
    echo "--- $pod ---"

    kubectl \
      -n marketplace-hw28 \
      logs "$pod" \
      --container marketplace \
      --tail=100 \
      || true

    echo
    echo "--- $pod previous ---"

    kubectl \
      -n marketplace-hw28 \
      logs "$pod" \
      --container marketplace \
      --previous \
      --tail=100 \
      || true
  done

  exit "$STATUS"
fi