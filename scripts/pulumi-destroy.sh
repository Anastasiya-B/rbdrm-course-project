#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"

cd "$ROOT/infra"

npx pulumi login "$PULUMI_BACKEND_URL" >/dev/null
npx pulumi stack select dev

npx pulumi destroy \
  --yes \
  --non-interactive