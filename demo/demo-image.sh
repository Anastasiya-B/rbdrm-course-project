#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE="${IMAGE_NAME:-rbdrm-marketplace:hw28}"
DOCKERFILE="${DOCKERFILE:-$ROOT/docker/Dockerfile}"
TOKEN_FILE="${TOKEN_FILE:-$ROOT/.npm_token}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image not found: $IMAGE" >&2
  exit 1
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Build secret file not found: $TOKEN_FILE" >&2
  exit 1
fi

TOKEN="$(cat "$TOKEN_FILE")"

if [[ -z "$TOKEN" ]]; then
  echo "Build secret token is empty" >&2
  exit 1
fi

STAGES="$(
  awk '
    BEGIN { count = 0 }
    /^[[:space:]]*FROM[[:space:]]+/ {
      count += 1
    }
    END {
      print count
    }
  ' "$DOCKERFILE"
)"

if docker run \
  --rm \
  --entrypoint sh \
  "$IMAGE" \
  -c 'exit 0' \
  >/dev/null 2>&1; then
  SHELL_INSIDE=1
else
  SHELL_INSIDE=0
fi

RUNTIME_UID="$(
  docker run \
    --rm \
    "$IMAGE" \
    -e 'process.stdout.write(String(process.getuid()))'
)"

if docker history \
  --no-trunc \
  "$IMAGE" \
  2>/dev/null \
  | grep -aFq "$TOKEN"; then
  TOKEN_HISTORY=1
else
  TOKEN_HISTORY=0
fi

if docker image inspect \
  "$IMAGE" \
  2>/dev/null \
  | grep -aFq "$TOKEN"; then
  TOKEN_CONFIG=1
else
  TOKEN_CONFIG=0
fi

TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

docker save \
  "$IMAGE" \
  -o "$TMP_DIR/image.tar"

mkdir -p "$TMP_DIR/image"

tar -xf \
  "$TMP_DIR/image.tar" \
  -C "$TMP_DIR/image"

node - "$TMP_DIR/image/manifest.json" >"$TMP_DIR/layers.txt" <<'NODE'
const fs = require('node:fs');

const manifestPath = process.argv[2];

const manifest = JSON.parse(
  fs.readFileSync(
    manifestPath,
    'utf8',
  ),
);

for (const image of manifest) {
  for (const layer of image.Layers ?? []) {
    process.stdout.write(`${layer}\n`);
  }
}
NODE

TOKEN_LAYERS=0

while IFS= read -r layer; do
  [[ -n "$layer" ]] || continue

  LAYER_PATH="$TMP_DIR/image/$layer"

  if [[ ! -f "$LAYER_PATH" ]]; then
    continue
  fi

  if gzip -t "$LAYER_PATH" >/dev/null 2>&1; then
    if gzip -dc "$LAYER_PATH" \
      | grep -aFq "$TOKEN"; then
      TOKEN_LAYERS=1
      break
    fi
  else
    if grep -aFq "$TOKEN" "$LAYER_PATH"; then
      TOKEN_LAYERS=1
      break
    fi
  fi
done <"$TMP_DIR/layers.txt"

echo "stages=$STAGES"
echo "shell-inside=$SHELL_INSIDE"
echo "runtime-uid=$RUNTIME_UID"
echo "token-in-history=$TOKEN_HISTORY"
echo "token-in-config=$TOKEN_CONFIG"
echo "token-in-layers=$TOKEN_LAYERS"

if [[ "$STAGES" -lt 2 ]]; then
  exit 1
fi

if [[ "$SHELL_INSIDE" -ne 0 ]]; then
  exit 1
fi

if [[ "$RUNTIME_UID" -eq 0 ]]; then
  exit 1
fi

if [[ "$TOKEN_HISTORY" -ne 0 ]]; then
  exit 1
fi

if [[ "$TOKEN_CONFIG" -ne 0 ]]; then
  exit 1
fi

if [[ "$TOKEN_LAYERS" -ne 0 ]]; then
  exit 1
fi