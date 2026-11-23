#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMESPACE="${NAMESPACE:-marketplace-hw28}"
DEPLOYMENT="${DEPLOYMENT:-marketplace-deployment}"
PDB="${PDB:-marketplace-pdb}"
PROXY_PORT="${PROXY_PORT:-18001}"

TMP_DIR="$(mktemp -d)"
PROXY_LOG="$TMP_DIR/kubectl-proxy.log"
PROXY_PID=""

cleanup() {
  if [[ -n "${PROXY_PID:-}" ]]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
  fi

  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

cd "$ROOT"

if ! kubectl \
  -n "$NAMESPACE" \
  get deployment "$DEPLOYMENT" \
  >/dev/null 2>&1; then
  echo "Deployment $DEPLOYMENT not found" >&2
  exit 1
fi

if ! kubectl \
  -n "$NAMESPACE" \
  get pdb "$PDB" \
  >/dev/null 2>&1; then
  echo "PDB $PDB not found" >&2
  exit 1
fi

kubectl \
  -n "$NAMESPACE" \
  rollout status \
  deployment/"$DEPLOYMENT" \
  --timeout=180s \
  >/dev/null

HEALTHY="$(
  kubectl \
    -n "$NAMESPACE" \
    get pdb "$PDB" \
    -o jsonpath='{.status.currentHealthy}'
)"

MIN_AVAILABLE="$(
  kubectl \
    -n "$NAMESPACE" \
    get pdb "$PDB" \
    -o jsonpath='{.spec.minAvailable}'
)"

if [[ -z "$HEALTHY" ]]; then
  echo "Could not read currentHealthy from PDB" >&2
  exit 1
fi

if [[ -z "$MIN_AVAILABLE" ]]; then
  echo "Could not read minAvailable from PDB" >&2
  exit 1
fi

PODS=()

while IFS= read -r pod; do
  if [[ -n "$pod" ]]; then
    PODS[${#PODS[@]}]="$pod"
  fi
done < <(
  kubectl \
    -n "$NAMESPACE" \
    get pods \
    -l app=marketplace \
    --field-selector=status.phase=Running \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
    | sort
)

if [[ "${#PODS[@]}" -lt 3 ]]; then
  echo "Expected at least 3 running pods, found ${#PODS[@]}" >&2
  exit 1
fi

POD_1="${PODS[0]}"
POD_2="${PODS[1]}"

kubectl proxy \
  --port="$PROXY_PORT" \
  >"$PROXY_LOG" 2>&1 &

PROXY_PID="$!"

PROXY_URL="http://127.0.0.1:$PROXY_PORT"

PROXY_READY=0

for _ in {1..50}; do
  if curl \
    --silent \
    --fail \
    "$PROXY_URL/version" \
    >/dev/null 2>&1; then
    PROXY_READY=1
    break
  fi

  sleep 0.1
done

if [[ "$PROXY_READY" -ne 1 ]]; then
  echo "kubectl proxy did not become ready" >&2
  cat "$PROXY_LOG" >&2
  exit 1
fi

create_eviction_body() {
  local pod_name="$1"

  cat <<EOF
{
  "apiVersion": "policy/v1",
  "kind": "Eviction",
  "metadata": {
    "name": "$pod_name",
    "namespace": "$NAMESPACE"
  }
}
EOF
}

EVICT_1="$(
  create_eviction_body "$POD_1" |
    curl \
      --silent \
      --output "$TMP_DIR/evict-1.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "$PROXY_URL/api/v1/namespaces/$NAMESPACE/pods/$POD_1/eviction"
)"

CURRENT_HEALTHY="$HEALTHY"

for _ in {1..40}; do
  CURRENT_HEALTHY="$(
    kubectl \
      -n "$NAMESPACE" \
      get pdb "$PDB" \
      -o jsonpath='{.status.currentHealthy}'
  )"

  if [[ -n "$CURRENT_HEALTHY" ]] && \
     [[ "$CURRENT_HEALTHY" -le "$MIN_AVAILABLE" ]]; then
    break
  fi

  sleep 0.1
done

EVICT_2="$(
  create_eviction_body "$POD_2" |
    curl \
      --silent \
      --output "$TMP_DIR/evict-2.json" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "$PROXY_URL/api/v1/namespaces/$NAMESPACE/pods/$POD_2/eviction"
)"

echo "healthy=$HEALTHY"
echo "minAvailable=$MIN_AVAILABLE"
echo "evict-1=$EVICT_1"
echo "evict-2=$EVICT_2"

if [[ "$HEALTHY" -lt 3 ]]; then
  echo "Expected at least 3 healthy pods before eviction" >&2
  exit 1
fi

if [[ "$MIN_AVAILABLE" -ne 2 ]]; then
  echo "Expected minAvailable=2" >&2
  exit 1
fi

if [[ "$EVICT_1" -ne 201 ]]; then
  echo "First eviction should return HTTP 201" >&2
  cat "$TMP_DIR/evict-1.json" >&2
  exit 1
fi

if [[ "$EVICT_2" -ne 429 ]]; then
  echo "Second eviction should return HTTP 429" >&2
  cat "$TMP_DIR/evict-2.json" >&2
  exit 1
fi

kubectl \
  -n "$NAMESPACE" \
  rollout status \
  deployment/"$DEPLOYMENT" \
  --timeout=180s \
  >/dev/null