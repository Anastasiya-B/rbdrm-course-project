#!/usr/bin/env bash

set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-rbdrm-hw28}"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is required" >&2
  exit 1
fi

if kind get clusters | grep -qx "$CLUSTER_NAME"; then
  kind delete cluster \
    --name "$CLUSTER_NAME"
else
  echo "kind cluster does not exist: $CLUSTER_NAME"
fi