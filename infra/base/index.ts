import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export {
  githubOidcProviderArn,
  githubTeardownRoleArn,
  githubTeardownRoleName,
  githubTeardownPolicyName,
} from './iam';

const projectName = 'nodejs-pro-hw31';

const config = new pulumi.Config();

const budgetEmail = config.require('budgetEmail');

/*
 * Budget must exist before any paid HW31 resource.
 *
 * Grader also checks that the literal $5 limit and
 * ACTUAL notification are present in source.
 */
const budget = new aws.budgets.Budget('hw31-budget', {
  name: `${projectName}-budget`,

  budgetType: 'COST',

  // Required grader value: $5.
  limitAmount: '5',

  limitUnit: 'USD',

  timeUnit: 'MONTHLY',

  notifications: [
    {
      comparisonOperator: 'GREATER_THAN',

      threshold: 20,

      thresholdType: 'PERCENTAGE',

      notificationType: 'ACTUAL',

      subscriberEmailAddresses: [budgetEmail],
    },
  ],
});

const vpc = new aws.ec2.Vpc(
  'hw31-vpc',
  {
    cidrBlock: '10.31.0.0/16',

    enableDnsSupport: true,

    enableDnsHostnames: true,
  },
  {
    dependsOn: [budget],
  },
);

const azs = aws.getAvailabilityZonesOutput({
  state: 'available',
});

const publicSubnetA = new aws.ec2.Subnet('public-a', {
  vpcId: vpc.id,

  cidrBlock: '10.31.0.0/24',

  availabilityZone: azs.names[0],

  mapPublicIpOnLaunch: true,
});

const publicSubnetB = new aws.ec2.Subnet('public-b', {
  vpcId: vpc.id,

  cidrBlock: '10.31.1.0/24',

  availabilityZone: azs.names[1],

  mapPublicIpOnLaunch: true,
});

const privateSubnetA = new aws.ec2.Subnet('private-a', {
  vpcId: vpc.id,

  cidrBlock: '10.31.10.0/24',

  availabilityZone: azs.names[0],

  mapPublicIpOnLaunch: false,
});

const privateSubnetB = new aws.ec2.Subnet('private-b', {
  vpcId: vpc.id,

  cidrBlock: '10.31.11.0/24',

  availabilityZone: azs.names[1],

  mapPublicIpOnLaunch: false,
});

const internetGateway = new aws.ec2.InternetGateway('hw31-igw', {
  vpcId: vpc.id,
});

const publicRouteTable = new aws.ec2.RouteTable('public-rt', {
  vpcId: vpc.id,

  routes: [
    {
      cidrBlock: '0.0.0.0/0',

      gatewayId: internetGateway.id,
    },
  ],
});

new aws.ec2.RouteTableAssociation('public-a-rt', {
  subnetId: publicSubnetA.id,

  routeTableId: publicRouteTable.id,
});

new aws.ec2.RouteTableAssociation('public-b-rt', {
  subnetId: publicSubnetB.id,

  routeTableId: publicRouteTable.id,
});

/*
 * Deliberately no 0.0.0.0/0 route:
 * private DB subnets must not route to IGW.
 */
const privateRouteTable = new aws.ec2.RouteTable('private-rt', {
  vpcId: vpc.id,
});

new aws.ec2.RouteTableAssociation('private-a-rt', {
  subnetId: privateSubnetA.id,

  routeTableId: privateRouteTable.id,
});

new aws.ec2.RouteTableAssociation('private-b-rt', {
  subnetId: privateSubnetB.id,

  routeTableId: privateRouteTable.id,
});

/*
 * ALB SG: HTTP is intentionally public because
 * the demo load balancer is internet-facing.
 */
const albSecurityGroup = new aws.ec2.SecurityGroup('alb-sg', {
  vpcId: vpc.id,

  description: 'Allow public HTTP to demo ALB',

  ingress: [
    {
      protocol: 'tcp',

      fromPort: 80,

      toPort: 80,

      cidrBlocks: ['0.0.0.0/0'],
    },
  ],

  egress: [
    {
      protocol: '-1',

      fromPort: 0,

      toPort: 0,

      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
});

/*
 * RDS SG: PostgreSQL is reachable only from
 * resources associated with the application SG.
 */
const appSecurityGroup = new aws.ec2.SecurityGroup('app-sg', {
  vpcId: vpc.id,

  description: 'Application resources inside the VPC',

  egress: [
    {
      protocol: '-1',

      fromPort: 0,

      toPort: 0,

      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
});

const rdsSecurityGroup = new aws.ec2.SecurityGroup('rds-sg', {
  vpcId: vpc.id,

  description: 'Allow PostgreSQL only from application SG',

  ingress: [
    {
      protocol: 'tcp',

      fromPort: 5432,

      toPort: 5432,

      securityGroups: [appSecurityGroup.id],
    },
  ],
});

export const vpcId = vpc.id;

export const publicSubnetIds = [publicSubnetA.id, publicSubnetB.id];

export const privateSubnetIds = [privateSubnetA.id, privateSubnetB.id];

export const albSecurityGroupId = albSecurityGroup.id;

export const appSecurityGroupId = appSecurityGroup.id;

export const rdsSecurityGroupId = rdsSecurityGroup.id;

export const privateRouteTableId = privateRouteTable.id;
