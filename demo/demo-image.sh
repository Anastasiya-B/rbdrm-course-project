#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE="${IMAGE_NAME:-rbdrm-marketplace:hw28}"
DOCKERFILE="$ROOT/docker/Dockerfile"
TOKEN_FILE="$ROOT/.npm_token"

if [ ! -f "$DOCKERFILE" ]; then
  echo "Missing Dockerfile: $DOCKERFILE" >&2
  exit 1
fi

if [ ! -s "$TOKEN_FILE" ]; then
  echo "Missing or empty build secret: $TOKEN_FILE" >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Missing image: $IMAGE" >&2
  echo "Run: npm run image:build" >&2
  exit 1
fi

TOKEN="$(cat "$TOKEN_FILE")"

if [ -z "$TOKEN" ]; then
  echo "Build secret is empty" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

# 1. Number of Dockerfile stages.
STAGES="$(
  grep -cE '^[[:space:]]*FROM[[:space:]]+' "$DOCKERFILE" || true
)"

# 2. Check whether a shell actually exists in the final image.
set +e
docker run \
  --rm \
  --entrypoint sh \
  "$IMAGE" \
  -c 'exit 0' \
  >/dev/null 2>&1

SHELL_RC=$?
set -e

if [ "$SHELL_RC" -eq 0 ]; then
  SHELL_INSIDE=1
else
  SHELL_INSIDE=0
fi

# 3. Ask the actual runtime process for its UID.
RUNTIME_UID="$(
  docker run \
    --rm \
    "$IMAGE" \
    -e 'process.stdout.write(String(process.getuid()))'
)"

if ! [[ "$RUNTIME_UID" =~ ^[0-9]+$ ]]; then
  echo "Could not determine numeric runtime UID: $RUNTIME_UID" >&2
  exit 1
fi

# 4. Secret must not appear in docker history.
TOKEN_IN_HISTORY="$(
  (
    docker history \
      --no-trunc \
      --format '{{.CreatedBy}}' \
      "$IMAGE" \
      | grep -F -c -- "$TOKEN"
  ) || true
)"

# 5. Secret must not appear in image configuration / metadata.
TOKEN_IN_CONFIG="$(
  (
    docker image inspect "$IMAGE" \
      | grep -F -c -- "$TOKEN"
  ) || true
)"

# 6. Secret must not survive in any filesystem layer.
docker save \
  --output "$TMP_DIR/image.tar" \
  "$IMAGE"

mkdir -p "$TMP_DIR/image"

tar -xf \
  "$TMP_DIR/image.tar" \
  -C "$TMP_DIR/image"

node - "$TMP_DIR/image/manifest.json" > "$TMP_DIR/layers.txt" <<'NODE'
const fs = require('node:fs');

const manifestPath = process.argv[2];

const manifest = JSON.parse(
  fs.readFileSync(manifestPath, 'utf8'),
);

for (const image of manifest) {
  for (const layer of image.Layers ?? []) {
    process.stdout.write(`${layer}\n`);
  }
}
NODE

TOKEN_IN_LAYERS=0

while IFS= read -r layer; do
  [ -n "$layer" ] || continue

  layerPath="$TMP_DIR/image/$layer"

  if [ ! -f "$layerPath" ]; then
    echo "Layer listed in manifest is missing: $layer" >&2
    exit 1
  fi

  if grep -aFq -- "$TOKEN" "$layerPath"; then
    TOKEN_IN_LAYERS=$((TOKEN_IN_LAYERS + 1))
  fi
done < "$TMP_DIR/layers.txt"

echo "stages=$STAGES"
echo "shell-inside=$SHELL_INSIDE"
echo "runtime-uid=$RUNTIME_UID"
echo "token-in-history=$TOKEN_IN_HISTORY"
echo "token-in-config=$TOKEN_IN_CONFIG"
echo "token-in-layers=$TOKEN_IN_LAYERS"

PASSED=1

if [ "$STAGES" -lt 2 ]; then
  PASSED=0
fi

if [ "$SHELL_INSIDE" -ne 0 ]; then
  PASSED=0
fi

if [ "$RUNTIME_UID" -eq 0 ]; then
  PASSED=0
fi

if [ "$TOKEN_IN_HISTORY" -ne 0 ]; then
  PASSED=0
fi

if [ "$TOKEN_IN_CONFIG" -ne 0 ]; then
  PASSED=0
fi

if [ "$TOKEN_IN_LAYERS" -ne 0 ]; then
  PASSED=0
fi

if [ "$PASSED" -ne 1 ]; then
  exit 1
fi