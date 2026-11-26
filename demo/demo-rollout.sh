#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  pwd
)"

NAMESPACE="${ROLLOUT_NAMESPACE:-marketplace-hw28}"
DEPLOYMENT="${ROLLOUT_DEPLOYMENT:-marketplace-deployment}"
SERVICE="${ROLLOUT_SERVICE:-marketplace-service}"

MIN_REQUESTS="${MIN_REQUESTS:-5000}"
LOAD_SECONDS="${ROLLOUT_LOAD_SECONDS:-35}"
LOAD_CONCURRENCY="${ROLLOUT_LOAD_CONCURRENCY:-25}"

EVIDENCE_FILE="${EVIDENCE_FILE:-$ROOT/evidence/rollout-http-codes.txt}"

LOAD_POD="rollout-load-$RANDOM"
SERVICE_URL="http://${SERVICE}.${NAMESPACE}.svc.cluster.local:3000/healthz"

STARTED_AT="$(date +%s)"

cleanup() {
  kubectl \
    -n "$NAMESPACE" \
    delete pod "$LOAD_POD" \
    --ignore-not-found \
    --wait=false \
    >/dev/null 2>&1 \
    || true
}

trap cleanup EXIT

mkdir -p "$(dirname "$EVIDENCE_FILE")"

: > "$EVIDENCE_FILE"

if ! [[ "$MIN_REQUESTS" =~ ^[0-9]+$ ]]; then
  echo "MIN_REQUESTS must be a non-negative integer" >&2
  exit 1
fi

if ! [[ "$LOAD_SECONDS" =~ ^[0-9]+$ ]] || [ "$LOAD_SECONDS" -le 0 ]; then
  echo "ROLLOUT_LOAD_SECONDS must be a positive integer" >&2
  exit 1
fi

if ! [[ "$LOAD_CONCURRENCY" =~ ^[0-9]+$ ]] || [ "$LOAD_CONCURRENCY" -le 0 ]; then
  echo "ROLLOUT_LOAD_CONCURRENCY must be a positive integer" >&2
  exit 1
fi

echo "Checking current deployment readiness"

kubectl \
  -n "$NAMESPACE" \
  rollout status \
  "deployment/$DEPLOYMENT" \
  --timeout=120s

READY_REPLICAS="$(
  kubectl \
    -n "$NAMESPACE" \
    get deployment "$DEPLOYMENT" \
    -o jsonpath='{.status.readyReplicas}'
)"

DESIRED_REPLICAS="$(
  kubectl \
    -n "$NAMESPACE" \
    get deployment "$DEPLOYMENT" \
    -o jsonpath='{.spec.replicas}'
)"

if [ "${READY_REPLICAS:-0}" -lt "${DESIRED_REPLICAS:-1}" ]; then
  echo "Deployment is not fully ready before rollout" >&2
  exit 1
fi

REVISION="hw28-$(date +%s)"

BEFORE_REVISION="$(
  kubectl \
    -n "$NAMESPACE" \
    get deployment "$DEPLOYMENT" \
    -o jsonpath='{.spec.template.metadata.annotations.revision}'
)"

echo "Starting rollout revision: $REVISION"
echo "Starting in-cluster load against: $SERVICE_URL"

LOAD_SCRIPT="$(
  cat <<'NODE'
const url = process.env.TARGET_URL;
const durationSeconds = Number(process.env.LOAD_SECONDS);
const concurrency = Number(process.env.LOAD_CONCURRENCY);

if (!url) {
  throw new Error('TARGET_URL is required');
}

if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
  throw new Error('LOAD_SECONDS must be a positive integer');
}

if (!Number.isInteger(concurrency) || concurrency <= 0) {
  throw new Error('LOAD_CONCURRENCY must be a positive integer');
}

const deadline = Date.now() + durationSeconds * 1000;

async function worker() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(2000),
        headers: {
          connection: 'close',
        },
      });

      process.stdout.write(`${response.status}\n`);

      await response.body?.cancel();
    } catch {
      process.stdout.write('0\n');
    }
  }
}

await Promise.all(
  Array.from(
    { length: concurrency },
    () => worker(),
  ),
);
NODE
)"

kubectl \
  -n "$NAMESPACE" \
  run "$LOAD_POD" \
  --image=node:22-alpine \
  --restart=Never \
  --env="TARGET_URL=$SERVICE_URL" \
  --env="LOAD_SECONDS=$LOAD_SECONDS" \
  --env="LOAD_CONCURRENCY=$LOAD_CONCURRENCY" \
  --command \
  -- node \
  --input-type=module \
  -e "$LOAD_SCRIPT"

echo "Waiting for load pod to start"

for _ in $(seq 1 60); do
  PHASE="$(
    kubectl \
      -n "$NAMESPACE" \
      get pod "$LOAD_POD" \
      -o jsonpath='{.status.phase}' \
      2>/dev/null \
      || true
  )"

  if [ "$PHASE" = "Running" ] || [ "$PHASE" = "Succeeded" ]; then
    break
  fi

  if [ "$PHASE" = "Failed" ]; then
    echo "Load pod failed before rollout" >&2

    kubectl \
      -n "$NAMESPACE" \
      describe pod "$LOAD_POD" \
      || true

    kubectl \
      -n "$NAMESPACE" \
      logs "$LOAD_POD" \
      || true

    exit 1
  fi

  sleep 1
done

PHASE="$(
  kubectl \
    -n "$NAMESPACE" \
    get pod "$LOAD_POD" \
    -o jsonpath='{.status.phase}' \
    2>/dev/null \
    || true
)"

if [ "$PHASE" != "Running" ] && [ "$PHASE" != "Succeeded" ]; then
  echo "Load pod did not start in time" >&2

  kubectl \
    -n "$NAMESPACE" \
    describe pod "$LOAD_POD" \
    || true

  exit 1
fi

sleep 2

echo "Triggering Pulumi rollout"

set +e

REV="$REVISION" \
  npm run up

PULUMI_STATUS="$?"

set -e

if [ "$PULUMI_STATUS" -ne 0 ]; then
  echo "Pulumi rollout failed with exit code $PULUMI_STATUS" >&2

  kubectl \
    -n "$NAMESPACE" \
    get pods \
    -o wide \
    || true

  exit "$PULUMI_STATUS"
fi

kubectl \
  -n "$NAMESPACE" \
  rollout status \
  "deployment/$DEPLOYMENT" \
  --timeout=180s

AFTER_REVISION="$(
  kubectl \
    -n "$NAMESPACE" \
    get deployment "$DEPLOYMENT" \
    -o jsonpath='{.spec.template.metadata.annotations.revision}'
)"

if [ -z "$AFTER_REVISION" ] || [ "$BEFORE_REVISION" = "$AFTER_REVISION" ]; then
  echo "Deployment revision did not change during rollout" >&2
  exit 1
fi

echo "deployment \"$DEPLOYMENT\" successfully rolled out"

echo "Waiting for load generator to finish"

set +e

kubectl \
  -n "$NAMESPACE" \
  wait \
  --for=jsonpath='{.status.phase}'=Succeeded \
  "pod/$LOAD_POD" \
  --timeout="$((LOAD_SECONDS + 90))s"

LOAD_WAIT_STATUS="$?"

set -e

kubectl \
  -n "$NAMESPACE" \
  logs "$LOAD_POD" \
  > "$EVIDENCE_FILE" \
  || true

if [ "$LOAD_WAIT_STATUS" -ne 0 ]; then
  echo "Load generator did not finish successfully" >&2

  kubectl \
    -n "$NAMESPACE" \
    describe pod "$LOAD_POD" \
    || true

  exit 1
fi

REQUESTS="$(
  awk '
    /^[0-9]+$/ {
      count += 1
    }
    END {
      print count + 0
    }
  ' "$EVIDENCE_FILE"
)"

OK="$(
  awk '
    /^2[0-9][0-9]$/ {
      count += 1
    }
    END {
      print count + 0
    }
  ' "$EVIDENCE_FILE"
)"

FAILED="$(
  awk '
    /^[0-9]+$/ && $0 !~ /^2[0-9][0-9]$/ {
      count += 1
    }
    END {
      print count + 0
    }
  ' "$EVIDENCE_FILE"
)"

FINISHED_AT="$(date +%s)"
ROLLOUT_SECONDS="$((FINISHED_AT - STARTED_AT))"

echo "profile=correct"
echo "before-revision=$BEFORE_REVISION"
echo "after-revision=$AFTER_REVISION"
echo "rolling-update=true"
echo "requests=$REQUESTS"
echo "ok=$OK"
echo "failed=$FAILED"
echo "rollout-seconds=$ROLLOUT_SECONDS"

if [ "$REQUESTS" -lt "$MIN_REQUESTS" ]; then
  echo "Minimum request requirement failed" >&2
  exit 1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Zero-downtime requirement failed" >&2

  echo "Failed HTTP codes:" >&2

  awk '
    /^[0-9]+$/ && $0 !~ /^2[0-9][0-9]$/ {
      counts[$0] += 1
    }
    END {
      for (code in counts) {
        print code, counts[code]
      }
    }
  ' "$EVIDENCE_FILE" >&2

  exit 1
fi
