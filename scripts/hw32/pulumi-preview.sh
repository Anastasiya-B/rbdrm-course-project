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

npx pulumi login \
  "$PULUMI_BACKEND_URL" \
  >/dev/null

if ! npx pulumi stack select "$STACK_NAME" >/dev/null 2>&1; then
  npx pulumi stack init "$STACK_NAME"
fi

npx pulumi preview \
  --stack "$STACK_NAME" \
  --non-interactive \
  --json