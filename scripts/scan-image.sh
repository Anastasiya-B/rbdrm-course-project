#!/usr/bin/env bash

set -euo pipefail

IMAGE="${IMAGE_NAME:-rbdrm-marketplace:hw28}"
SEVERITY="${SCAN_SEVERITY:-HIGH,CRITICAL}"
MAX_ALLOWED="${SCAN_MAX:-10}"

TMP_DIR="$(mktemp -d)"
REPORT="$TMP_DIR/trivy.json"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Missing image: $IMAGE" >&2
  echo "Run: npm run image:build" >&2
  exit 1
fi

if ! [[ "$MAX_ALLOWED" =~ ^-?[0-9]+$ ]]; then
  echo "SCAN_MAX must be an integer" >&2
  exit 1
fi

docker run \
  --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v trivy-cache:/root/.cache/ \
  -v "$TMP_DIR:/out" \
  aquasec/trivy:0.76.2 \
  image \
  --scanners vuln \
  --format json \
  --severity "$SEVERITY" \
  --output /out/trivy.json \
  "$IMAGE"

FOUND="$(
  node - "$REPORT" <<'NODE'
const fs = require('node:fs');

const path = process.argv[2];

const report = JSON.parse(
  fs.readFileSync(path, 'utf8'),
);

let count = 0;

for (const result of report.Results ?? []) {
  count +=
    (result.Vulnerabilities ?? []).length;
}

process.stdout.write(
  String(count),
);
NODE
)"

echo "image=$IMAGE"
echo "severity=$SEVERITY"
echo "found=$FOUND"
echo "max-allowed=$MAX_ALLOWED"

if [ "$FOUND" -le "$MAX_ALLOWED" ]; then
  echo "gate=pass"
  exit 0
fi

echo "gate=fail"
exit 1