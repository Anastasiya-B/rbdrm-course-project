#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"
shift || true

[ "$#" -gt 0 ] || set -- npm run start

# Grader has no access to the vault: values are already in the environment.
if [ "${SKIP_VAULT:-0}" = "1" ]; then
  exec "$@"
fi

CREDS="$ROOT/.secrets/infisical.env"

if [ ! -f "$CREDS" ]; then
  echo "Missing Infisical credentials file: $CREDS" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CREDS"
set +a

exec npx infisical run --env="$ENV_SLUG" -- "$@"