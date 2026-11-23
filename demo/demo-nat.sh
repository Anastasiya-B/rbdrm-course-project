#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="$ROOT/infra/demo"
EVIDENCE="$ROOT/evidence/demos.txt"

export PULUMI_CONFIG_PASSPHRASE="${PULUMI_CONFIG_PASSPHRASE:-hw31-local}"
REGION="${AWS_REGION:-eu-north-1}"

mkdir -p "$ROOT/evidence"
touch "$EVIDENCE"

cd "$DEMO"

npx pulumi stack select dev >/dev/null

ORIGINAL_WITH_NAT="$(
  npx pulumi config get withNat 2>/dev/null || echo "false"
)"

cleanup() {
  if [ "$ORIGINAL_WITH_NAT" != "true" ]; then
    npx pulumi config set withNat false >/dev/null 2>&1 || true
    npx pulumi up --yes >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

npx pulumi config set withNat true

START="$(date +%s)"

npx pulumi up --yes

NAT_ID="$(npx pulumi stack output natGatewayId)"

STATE="$(
  aws ec2 describe-nat-gateways \
    --region "$REGION" \
    --nat-gateway-ids "$NAT_ID" \
    --query 'NatGateways[0].State' \
    --output text
)"

if [ "$STATE" != "available" ]; then
  echo "NAT Gateway is not available: state=$STATE" >&2
  exit 1
fi

npx pulumi config set withNat false
npx pulumi up --yes

END="$(date +%s)"

trap - EXIT

SECONDS_ALIVE=$((END - START))

# Human-readable observed lifetime rounded up to a full minute.
NAT_MINUTES=$(((SECONDS_ALIVE + 59) / 60))

# AWS bills each partial NAT Gateway hour as a whole hour.
NAT_BILLED_HOURS=$(((SECONDS_ALIVE + 3599) / 3600))

if [ "$NAT_MINUTES" -ge 60 ]; then
  echo "NAT lived too long: nat-minutes=$NAT_MINUTES" >&2
  exit 1
fi

if [ "$NAT_BILLED_HOURS" -ne 1 ]; then
  echo "Unexpected billed hours: nat-billed-hours=$NAT_BILLED_HOURS" >&2
  exit 1
fi

LEFT="$(
  aws ec2 describe-nat-gateways \
    --region "$REGION" \
    --filter Name=state,Values=available \
    --query 'length(NatGateways)' \
    --output text
)"

if [ "$LEFT" -ne 0 ]; then
  echo "Available NAT Gateways remain after demo: $LEFT" >&2
  exit 1
fi

TMP="$(mktemp)"

grep -vE '^(nat-minutes|nat-billed-hours)=' "$EVIDENCE" > "$TMP" || true

cat "$TMP" > "$EVIDENCE"
rm -f "$TMP"

cat >> "$EVIDENCE" <<EOF
nat-minutes=$NAT_MINUTES
nat-billed-hours=$NAT_BILLED_HOURS
EOF

echo "nat-minutes=$NAT_MINUTES"
echo "nat-billed-hours=$NAT_BILLED_HOURS"