#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"

cd "$ROOT/infra"

npx pulumi login "$PULUMI_BACKEND_URL" >/dev/null

if ! npx pulumi stack select dev >/dev/null 2>&1; then
  npx pulumi stack init dev
fi

npx pulumi up \
  --yes \
  --non-interactive