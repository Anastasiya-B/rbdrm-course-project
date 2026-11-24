#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.."
  pwd
)"

BASE_SPEC="${1:?base spec path is required}"
REVISION_SPEC="${2:?revision spec path is required}"

OASDIFF_IMAGE="${OASDIFF_IMAGE:-tufin/oasdiff:v1.35.0}"

BASE_ABS="$(
  cd "$(dirname "$BASE_SPEC")"
  printf '%s/%s' "$PWD" "$(basename "$BASE_SPEC")"
)"

REVISION_ABS="$(
  cd "$(dirname "$REVISION_SPEC")"
  printf '%s/%s' "$PWD" "$(basename "$REVISION_SPEC")"
)"

case "$BASE_ABS" in
  "$ROOT"/*)
    ;;
  *)
    echo "Base spec must be inside repository root" >&2
    exit 2
    ;;
esac

case "$REVISION_ABS" in
  "$ROOT"/*)
    ;;
  *)
    echo "Revision spec must be inside repository root" >&2
    exit 2
    ;;
esac

BASE_CONTAINER_PATH="/repo/${BASE_ABS#"$ROOT"/}"
REVISION_CONTAINER_PATH="/repo/${REVISION_ABS#"$ROOT"/}"

docker run \
  --rm \
  -v "$ROOT:/repo:ro" \
  "$OASDIFF_IMAGE" \
  breaking \
  --fail-on ERR \
  -- \
  "$BASE_CONTAINER_PATH" \
  "$REVISION_CONTAINER_PATH"