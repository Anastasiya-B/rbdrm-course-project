#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CLUSTER_NAME="${KIND_CLUSTER_NAME:-rbdrm-hw28}"
IMAGE="${IMAGE_NAME:-rbdrm-marketplace:hw28}"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is required" >&2
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Missing image: $IMAGE" >&2
  echo "Run: npm run image:build" >&2
  exit 1
fi

if kind get clusters | grep -qx "$CLUSTER_NAME"; then
  echo "kind cluster already exists: $CLUSTER_NAME"
else
  kind create cluster \
    --name "$CLUSTER_NAME" \
    --config "$ROOT/k8s/kind-config.yaml"
fi

kind load docker-image \
  "$IMAGE" \
  --name "$CLUSTER_NAME"

kubectl cluster-info \
  --context "kind-$CLUSTER_NAME"

kubectl get nodes