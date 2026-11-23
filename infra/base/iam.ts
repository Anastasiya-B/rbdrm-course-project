import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();

const githubOwner = config.require('githubOwner');
const githubRepo = config.require('githubRepo');

const oidcProvider = new aws.iam.OpenIdConnectProvider('github-actions-oidc', {
  url: 'https://token.actions.githubusercontent.com',

  clientIdLists: ['sts.amazonaws.com'],
});

const assumeRolePolicy = pulumi.all([oidcProvider.arn]).apply(([providerArn]) =>
  JSON.stringify({
    Version: '2012-10-17',

    Statement: [
      {
        Effect: 'Allow',

        Principal: {
          Federated: providerArn,
        },

        Action: 'sts:AssumeRoleWithWebIdentity',

        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },

          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${githubOwner}/${githubRepo}:*`,
          },
        },
      },
    ],
  }),
);

const teardownRole = new aws.iam.Role('github-teardown-role', {
  name: 'nodejs-pro-hw31-github-teardown',

  assumeRolePolicy,
});

/*
 * Least-privilege role for HW31 teardown and verification.
 *
 * No wildcard Action is used.
 */
const teardownPolicy = new aws.iam.RolePolicy('github-teardown-policy', {
  role: teardownRole.id,

  policy: JSON.stringify({
    Version: '2012-10-17',

    Statement: [
      {
        Effect: 'Allow',

        Action: [
          // EC2 / VPC reads.
          'ec2:DescribeAccountAttributes',
          'ec2:DescribeAddresses',
          'ec2:DescribeAvailabilityZones',
          'ec2:DescribeInternetGateways',
          'ec2:DescribeNatGateways',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DescribeRouteTables',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeSubnets',
          'ec2:DescribeTags',
          'ec2:DescribeVpcAttribute',
          'ec2:DescribeVpcs',

          // EC2 / VPC teardown.
          'ec2:DeleteNatGateway',
          'ec2:ReleaseAddress',
          'ec2:DeleteRoute',
          'ec2:DisassociateRouteTable',
          'ec2:DeleteRouteTable',
          'ec2:DeleteSubnet',
          'ec2:DetachInternetGateway',
          'ec2:DeleteInternetGateway',
          'ec2:DeleteSecurityGroup',
          'ec2:DeleteVpc',

          // RDS reads.
          'rds:DescribeDBInstances',
          'rds:DescribeDBSubnetGroups',
          'rds:DescribeEvents',
          'rds:ListTagsForResource',

          // RDS teardown.
          'rds:DeleteDBInstance',
          'rds:DeleteDBSubnetGroup',

          // ALB reads.
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:DescribeLoadBalancers',
          'elasticloadbalancing:DescribeTags',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:DescribeTargetHealth',

          // ALB teardown.
          'elasticloadbalancing:DeregisterTargets',
          'elasticloadbalancing:DeleteListener',
          'elasticloadbalancing:DeleteTargetGroup',
          'elasticloadbalancing:DeleteLoadBalancer',

          // Lambda reads / teardown.
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
          'lambda:GetPolicy',
          'lambda:ListTags',
          'lambda:RemovePermission',
          'lambda:DeleteFunction',

          // IAM resources created by base/demo.
          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:GetOpenIDConnectProvider',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          'iam:DetachRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:DeleteRole',
          'iam:DeleteOpenIDConnectProvider',

          // Budget read/delete.
          // DeleteBudget is authorized by ModifyBudget.
          'budgets:ViewBudget',
          'budgets:ModifyBudget',

          // Required by AWS Budgets authorization.
          'aws-portal:ViewBilling',
          'aws-portal:ModifyBilling',

          // Final tagged-resource verification.
          'tag:GetResources',
        ],

        Resource: '*',
      },
    ],
  }),
});

export const githubOidcProviderArn = oidcProvider.arn;

export const githubTeardownRoleArn = teardownRole.arn;

export const githubTeardownRoleName = teardownRole.name;

export const githubTeardownPolicyName = teardownPolicy.name;
