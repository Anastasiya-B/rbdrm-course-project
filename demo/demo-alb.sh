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

ALB_DNS="$(npx pulumi stack output albDnsName)"
TG_ARN="$(npx pulumi stack output targetGroupArn)"

HTTP_CODE=""
TARGET_STATE=""

for _ in {1..30}; do
  HTTP_CODE="$(
    curl -sS \
      -o /tmp/hw31-alb-response.txt \
      -w '%{http_code}' \
      "http://${ALB_DNS}/" || true
  )"

  TARGET_STATE="$(
    aws elbv2 describe-target-health \
      --region "$REGION" \
      --target-group-arn "$TG_ARN" \
      --query 'TargetHealthDescriptions[0].TargetHealth.State' \
      --output text
  )"

  if [ "$HTTP_CODE" = "200" ] && [ "$TARGET_STATE" = "healthy" ]; then
    break
  fi

  sleep 5
done

if [ "$HTTP_CODE" != "200" ]; then
  echo "ALB HTTP check failed: http-code=$HTTP_CODE" >&2
  exit 1
fi

if [ "$TARGET_STATE" != "healthy" ]; then
  echo "ALB target is not healthy: target-state=$TARGET_STATE" >&2
  exit 1
fi

TMP="$(mktemp)"

grep -vE '^(alb-dns|http-code|target-state)=' "$EVIDENCE" > "$TMP" || true

cat "$TMP" > "$EVIDENCE"
rm -f "$TMP"

cat >> "$EVIDENCE" <<EOF
alb-dns=$ALB_DNS
http-code=$HTTP_CODE
target-state=$TARGET_STATE
EOF

echo "alb-dns=$ALB_DNS"
echo "http-code=$HTTP_CODE"
echo "target-state=$TARGET_STATE"