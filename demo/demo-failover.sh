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

DB_ID="$(npx pulumi stack output dbIdentifier)"

STATUS="$(
  aws rds describe-db-instances \
    --region "$REGION" \
    --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].DBInstanceStatus' \
    --output text
)"

if [ "$STATUS" != "available" ]; then
  echo "RDS must be available before failover, current status=$STATUS" >&2
  exit 1
fi

AZ_BEFORE="$(
  aws rds describe-db-instances \
    --region "$REGION" \
    --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].AvailabilityZone' \
    --output text
)"

START="$(date +%s)"

aws rds reboot-db-instance \
  --region "$REGION" \
  --db-instance-identifier "$DB_ID" \
  --force-failover \
  >/dev/null

# First prove that AWS actually started the reboot/failover.
STARTED=0

for _ in {1..30}; do
  STATUS="$(
    aws rds describe-db-instances \
      --region "$REGION" \
      --db-instance-identifier "$DB_ID" \
      --query 'DBInstances[0].DBInstanceStatus' \
      --output text
  )"

  if [ "$STATUS" != "available" ]; then
    STARTED=1
    break
  fi

  sleep 2
done

if [ "$STARTED" -ne 1 ]; then
  echo "RDS never left available state after forced failover" >&2
  exit 1
fi

aws rds wait db-instance-available \
  --region "$REGION" \
  --db-instance-identifier "$DB_ID"

END="$(date +%s)"
FAILOVER_SECONDS=$((END - START))

# DescribeDBInstances can briefly report the old AZ even after
# the failover-completed event, so poll for the AZ transition.
AZ_AFTER="$AZ_BEFORE"

for _ in {1..30}; do
  AZ_NOW="$(
    aws rds describe-db-instances \
      --region "$REGION" \
      --db-instance-identifier "$DB_ID" \
      --query 'DBInstances[0].AvailabilityZone' \
      --output text
  )"

  if [ "$AZ_NOW" != "$AZ_BEFORE" ]; then
    AZ_AFTER="$AZ_NOW"
    break
  fi

  sleep 10
done

EVENT="$(
  aws rds describe-events \
    --region "$REGION" \
    --source-type db-instance \
    --source-identifier "$DB_ID" \
    --duration 60 \
    --output json \
  | jq -r '
      [.Events[]
        | select(.Message | test("failover"; "i"))
      ]
      | sort_by(.Date)
      | last
      | .Message // ""
    '
)"

if [ "$AZ_BEFORE" = "$AZ_AFTER" ]; then
  echo "Failover did not change AZ: $AZ_BEFORE -> $AZ_AFTER" >&2
  exit 1
fi

if [ "$FAILOVER_SECONDS" -lt 20 ] || [ "$FAILOVER_SECONDS" -gt 600 ]; then
  echo "Failover duration out of accepted range: $FAILOVER_SECONDS" >&2
  exit 1
fi

if [ -z "$EVENT" ]; then
  echo "No RDS failover event found" >&2
  exit 1
fi

TMP="$(mktemp)"

grep -vE '^(az-before|az-after|failover-seconds|event)=' "$EVIDENCE" > "$TMP" || true

cat "$TMP" > "$EVIDENCE"
rm -f "$TMP"

cat >> "$EVIDENCE" <<EOF
az-before=$AZ_BEFORE
az-after=$AZ_AFTER
failover-seconds=$FAILOVER_SECONDS
event=$EVENT
EOF

echo "az-before=$AZ_BEFORE"
echo "az-after=$AZ_AFTER"
echo "failover-seconds=$FAILOVER_SECONDS"
echo "event=$EVENT"