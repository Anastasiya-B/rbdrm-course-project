#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$ROOT/infra/base"
EVIDENCE="$ROOT/evidence"

REGION="${AWS_REGION:-eu-central-1}"

mkdir -p "$EVIDENCE"

cd "$INFRA"

export PULUMI_CONFIG_PASSPHRASE="${PULUMI_CONFIG_PASSPHRASE:-hw31-local}"

npx pulumi stack select dev >/dev/null

VPC_ID="$(npx pulumi stack output vpcId)"
PRIVATE_RT_ID="$(npx pulumi stack output privateRouteTableId)"

PUBLIC_SUBNETS_JSON="$(
  npx pulumi stack output publicSubnetIds --json
)"

PRIVATE_SUBNETS_JSON="$(
  npx pulumi stack output privateSubnetIds --json
)"

ROLE_ARN="$(npx pulumi stack output githubTeardownRoleArn)"
ROLE_NAME="$(npx pulumi stack output githubTeardownRoleName)"
POLICY_NAME="$(npx pulumi stack output githubTeardownPolicyName)"

PUBLIC_SUBNET_COUNT="$(
  printf '%s' "$PUBLIC_SUBNETS_JSON" | jq 'length'
)"

PRIVATE_SUBNET_COUNT="$(
  printf '%s' "$PRIVATE_SUBNETS_JSON" | jq 'length'
)"

ALL_SUBNETS="$(
  jq -nr \
    --argjson pub "$PUBLIC_SUBNETS_JSON" \
    --argjson priv "$PRIVATE_SUBNETS_JSON" \
    '$pub + $priv | join(" ")'
)"

SUBNET_AZS="$(
  aws ec2 describe-subnets \
    --region "$REGION" \
    --subnet-ids $ALL_SUBNETS \
    --query 'length(unique_by(Subnets,&AvailabilityZone)[].AvailabilityZone)' \
    --output text
)"

PRIVATE_DEFAULT_ROUTE="$(
  aws ec2 describe-route-tables \
    --region "$REGION" \
    --route-table-ids "$PRIVATE_RT_ID" \
    --query 'length(RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`])' \
    --output text
)"

SECURITY_GROUPS="$(
  aws ec2 describe-security-groups \
    --region "$REGION" \
    --filters \
      "Name=vpc-id,Values=$VPC_ID" \
      "Name=tag:Project,Values=nodejs-pro-hw31" \
    --query 'length(SecurityGroups)' \
    --output text
)"

TAGGED_RESOURCES="$(
  aws resourcegroupstaggingapi get-resources \
    --region "$REGION" \
    --tag-filters \
      Key=Project,Values=nodejs-pro-hw31 \
    --query 'length(ResourceTagMappingList)' \
    --output text
)"

cat > "$EVIDENCE/base.txt" <<EOF
vpc-id=$VPC_ID
public-subnets=$PUBLIC_SUBNET_COUNT
private-subnets=$PRIVATE_SUBNET_COUNT
subnet-azs=$SUBNET_AZS
private-default-route=$PRIVATE_DEFAULT_ROUTE
security-groups=$SECURITY_GROUPS
tagged-resources=$TAGGED_RESOURCES
EOF

npx pulumi stack export > "$EVIDENCE/base-state.json"

ROLE_JSON="$(
  aws iam get-role \
    --role-name "$ROLE_NAME" \
    --output json
)"

POLICY_JSON="$(
  aws iam get-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$POLICY_NAME" \
    --output json
)"

jq -n \
  --argjson role "$ROLE_JSON" \
  --argjson policy "$POLICY_JSON" \
  '{
    Role: $role.Role,
    PermissionPolicy: $policy.PolicyDocument
  }' \
  > "$EVIDENCE/iam.json"

SIM_ALLOWED="$(
  aws iam simulate-principal-policy \
    --policy-source-arn "$ROLE_ARN" \
    --action-names ec2:DescribeVpcs \
    --query 'EvaluationResults[0].EvalDecision' \
    --output text
)"

SIM_DENIED="$(
  aws iam simulate-principal-policy \
    --policy-source-arn "$ROLE_ARN" \
    --action-names s3:PutObject \
    --query 'EvaluationResults[0].EvalDecision' \
    --output text
)"

cat > "$EVIDENCE/iam.txt" <<EOF
sim-allowed=$SIM_ALLOWED
sim-denied=$SIM_DENIED
EOF

echo
echo "=== evidence/base.txt ==="
cat "$EVIDENCE/base.txt"

echo
echo "=== evidence/iam.txt ==="
cat "$EVIDENCE/iam.txt"