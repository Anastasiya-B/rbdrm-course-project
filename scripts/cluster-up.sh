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

load_image_by_tag() {
  local image="$1"

  kind load docker-image \
    "$image" \
    --name "$CLUSTER_NAME"
}

load_image_by_digest() {
  local image="$1"

  local repository
  local digest
  local digest_short
  local local_tag
  local archive

  repository="${image%@*}"
  digest="${image##*@}"
  digest_short="${digest#sha256:}"
  digest_short="${digest_short:0:16}"

  local_tag="${repository}:kind-${digest_short}"
  archive="$(mktemp -t hw32-kind-image.XXXXXX.tar)"

  cleanup_archive() {
    rm -f "$archive"
  }

  trap cleanup_archive RETURN

  echo "Preparing kind image alias:"
  echo "  source=$image"
  echo "  local-tag=$local_tag"

  docker tag \
    "$image" \
    "$local_tag"

  docker image save \
    --platform linux/amd64 \
    --output "$archive" \
    "$local_tag"

  kind load image-archive \
    "$archive" \
    --name "$CLUSTER_NAME"

  mapfile -t KIND_NODES < <(
    docker ps \
      --filter "label=io.x-k8s.kind.cluster=$CLUSTER_NAME" \
      --format '{{.Names}}'
  )

  if [ "${#KIND_NODES[@]}" -eq 0 ]; then
    echo "No kind nodes found for cluster: $CLUSTER_NAME" >&2
    exit 1
  fi

  for node in "${KIND_NODES[@]}"; do
    echo "Registering digest alias on $node"

    docker exec \
      "$node" \
      ctr \
      --namespace=k8s.io \
      images \
      tag \
      "$local_tag" \
      "$image"

    docker exec \
      "$node" \
      ctr \
      --namespace=k8s.io \
      images \
      check \
      name=="$image"
  done

  rm -f "$archive"
  trap - RETURN
}

if [[ "$IMAGE" == *@sha256:* ]]; then
  load_image_by_digest "$IMAGE"
else
  load_image_by_tag "$IMAGE"
fi

kubectl cluster-info \
  --context "kind-$CLUSTER_NAME"

kubectl get nodes