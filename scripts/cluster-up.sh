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

load_regular_image() {
  local image="$1"

  kind load docker-image \
    "$image" \
    --name "$CLUSTER_NAME"
}

load_digest_image() {
  local image="$1"

  local digest
  local digest_short
  local local_tag

  digest="${image##*@}"
  digest_short="${digest#sha256:}"
  digest_short="${digest_short:0:16}"

  local_tag="rbdrm-hw32-kind:${digest_short}"

  echo "Preparing kind image alias:"
  echo "  source=$image"
  echo "  local-tag=$local_tag"

  docker tag \
    "$image" \
    "$local_tag"

  kind load docker-image \
    "$local_tag" \
    --name "$CLUSTER_NAME"

  for node in $(kind get nodes --name "$CLUSTER_NAME"); do
    echo "Registering immutable digest reference on $node"

    source_ref="$(
      docker exec \
        "$node" \
        ctr \
        --namespace=k8s.io \
        images \
        list \
        --quiet \
        | grep -F "$local_tag" \
        | head -n 1
    )"

    if [ -z "$source_ref" ]; then
      echo "Loaded image alias not found in containerd on node: $node" >&2

      docker exec \
        "$node" \
        ctr \
        --namespace=k8s.io \
        images \
        list

      exit 1
    fi

    echo "  containerd-source=$source_ref"
    echo "  immutable-target=$image"

    docker exec \
      "$node" \
      ctr \
      --namespace=k8s.io \
      images \
      tag \
      "$source_ref" \
      "$image"

    if ! docker exec \
      "$node" \
      ctr \
      --namespace=k8s.io \
      images \
      list \
      --quiet \
      | grep -Fx "$image" \
      >/dev/null; then

      echo "Immutable image reference was not registered on node: $node" >&2

      docker exec \
        "$node" \
        ctr \
        --namespace=k8s.io \
        images \
        list

      exit 1
    fi
  done
}

if [[ "$IMAGE" == *@sha256:* ]]; then
  load_digest_image "$IMAGE"
else
  load_regular_image "$IMAGE"
fi

kubectl cluster-info \
  --context "kind-$CLUSTER_NAME"

kubectl get nodes