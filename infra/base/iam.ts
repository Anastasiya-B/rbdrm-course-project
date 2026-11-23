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
 * CI role is intentionally limited to operations needed by
 * Pulumi destroy and HW31 teardown verification.
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
          'ec2:DescribeAddresses',
          'ec2:DescribeAvailabilityZones',
          'ec2:DescribeInternetGateways',
          'ec2:DescribeNatGateways',
          'ec2:DescribeRouteTables',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeSubnets',
          'ec2:DescribeVpcs',
          'ec2:DescribeTags',

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

          'rds:DescribeDBInstances',
          'rds:DescribeDBSubnetGroups',
          'rds:ListTagsForResource',
          'rds:DeleteDBInstance',
          'rds:DeleteDBSubnetGroup',

          'elasticloadbalancing:DescribeLoadBalancers',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:DescribeTargetHealth',
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:DeleteListener',
          'elasticloadbalancing:DeleteTargetGroup',
          'elasticloadbalancing:DeleteLoadBalancer',

          'tag:GetResources',

          'budgets:ViewBudget',
          'budgets:DeleteBudget',

          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:ListRolePolicies',
          'iam:DeleteRolePolicy',
          'iam:DeleteRole',
          'iam:GetOpenIDConnectProvider',
          'iam:DeleteOpenIDConnectProvider',
        ],

        Resource: '*',
      },
    ],
  }),
});

export const githubOidcProviderArn = oidcProvider.arn;

export const githubTeardownRoleArn = teardownRole.arn;

export const githubTeardownPolicyName = teardownPolicy.name;
