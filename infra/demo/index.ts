import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();

const withNat = config.getBoolean('withNat') ?? false;

const baseStackRef = config.require('baseStackRef');

const dbPassword = process.env.APP_DB_PASSWORD;

if (!dbPassword) {
  throw new Error('APP_DB_PASSWORD is required');
}

/*
 * This transform must be registered before any RDS
 * instance is created so destroy cannot be blocked
 * by deletion protection or a final snapshot.
 */
pulumi.runtime.registerResourceTransform(args => {
  if (args.type !== 'aws:rds/instance:Instance') {
    return undefined;
  }

  return {
    props: {
      ...args.props,

      deletionProtection: false,

      skipFinalSnapshot: true,
    },

    opts: args.opts,
  };
});

const base = new pulumi.StackReference(baseStackRef);

const vpcId = base.requireOutput('vpcId') as pulumi.Output<string>;

const publicSubnetIds = base.requireOutput('publicSubnetIds') as pulumi.Output<
  string[]
>;

const privateSubnetIds = base.requireOutput(
  'privateSubnetIds',
) as pulumi.Output<string[]>;

const albSecurityGroupId = base.requireOutput(
  'albSecurityGroupId',
) as pulumi.Output<string>;

const rdsSecurityGroupId = base.requireOutput(
  'rdsSecurityGroupId',
) as pulumi.Output<string>;

const privateRouteTableId = base.requireOutput(
  'privateRouteTableId',
) as pulumi.Output<string>;

/*
 * -------------------------
 * RDS
 * -------------------------
 */

const dbSubnetGroup = new aws.rds.SubnetGroup('hw31-db-subnet-group', {
  subnetIds: privateSubnetIds,

  description: 'HW31 private RDS subnet group',
});

const database = new aws.rds.Instance('hw31-postgres', {
  identifier: 'nodejs-pro-hw31-postgres',

  engine: 'postgres',

  instanceClass: 'db.t4g.micro',

  allocatedStorage: 20,

  storageType: 'gp3',

  storageEncrypted: true,

  multiAz: true,

  dbName: 'marketplace',

  username: 'marketplace',

  password: pulumi.secret(dbPassword),

  dbSubnetGroupName: dbSubnetGroup.name,

  vpcSecurityGroupIds: [rdsSecurityGroupId],

  publiclyAccessible: false,

  backupRetentionPeriod: 1,

  deletionProtection: false,

  skipFinalSnapshot: true,

  performanceInsightsEnabled: false,

  monitoringInterval: 0,

  autoMinorVersionUpgrade: true,

  applyImmediately: true,
});

/*
 * -------------------------
 * ALB target Lambda
 * -------------------------
 */

const lambdaRole = new aws.iam.Role('hw31-alb-lambda-role', {
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',

    Statement: [
      {
        Effect: 'Allow',

        Principal: {
          Service: 'lambda.amazonaws.com',
        },

        Action: 'sts:AssumeRole',
      },
    ],
  }),
});

new aws.iam.RolePolicyAttachment('hw31-lambda-basic-execution', {
  role: lambdaRole.name,

  policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
});

const targetLambda = new aws.lambda.Function('hw31-alb-target', {
  role: lambdaRole.arn,

  runtime: 'nodejs22.x',

  handler: 'index.handler',

  timeout: 5,

  memorySize: 128,

  code: new pulumi.asset.AssetArchive({
    'index.js': new pulumi.asset.StringAsset(`
exports.handler = async () => {
  return {
    statusCode: 200,
    statusDescription: '200 OK',
    isBase64Encoded: false,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      status: 'ok',
      service: 'nodejs-pro-hw31'
    })
  };
};
`),
  }),
});

const targetGroup = new aws.lb.TargetGroup('hw31-lambda-target-group', {
  targetType: 'lambda',

  healthCheck: {
    enabled: true,

    interval: 35,

    timeout: 30,

    healthyThreshold: 2,

    unhealthyThreshold: 2,

    matcher: '200',
  },
});

const lambdaPermission = new aws.lambda.Permission('allow-alb-invoke-lambda', {
  action: 'lambda:InvokeFunction',

  function: targetLambda.name,

  principal: 'elasticloadbalancing.amazonaws.com',

  sourceArn: targetGroup.arn,
});

new aws.lb.TargetGroupAttachment(
  'hw31-lambda-target-attachment',
  {
    targetGroupArn: targetGroup.arn,

    targetId: targetLambda.arn,
  },
  {
    dependsOn: [lambdaPermission],
  },
);

/*
 * -------------------------
 * Internet-facing ALB
 * -------------------------
 */

const loadBalancer = new aws.lb.LoadBalancer('hw31-alb', {
  loadBalancerType: 'application',

  internal: false,

  subnets: publicSubnetIds,

  securityGroups: [albSecurityGroupId],
});

const listener = new aws.lb.Listener('hw31-http-listener', {
  loadBalancerArn: loadBalancer.arn,

  port: 80,

  protocol: 'HTTP',

  defaultActions: [
    {
      type: 'forward',

      targetGroupArn: targetGroup.arn,
    },
  ],
});

/*
 * -------------------------
 * Optional NAT measurement
 * -------------------------
 *
 * NAT exists only while:
 *
 * hw31:withNat=true
 */

let natGateway: aws.ec2.NatGateway | undefined;

let natEip: aws.ec2.Eip | undefined;

if (withNat) {
  natEip = new aws.ec2.Eip('hw31-nat-eip', {
    domain: 'vpc',
  });

  natGateway = new aws.ec2.NatGateway('hw31-nat', {
    allocationId: natEip.id,

    subnetId: publicSubnetIds.apply(ids => ids[0]),
  });

  new aws.ec2.Route('hw31-private-default-route', {
    routeTableId: privateRouteTableId,

    destinationCidrBlock: '0.0.0.0/0',

    natGatewayId: natGateway.id,
  });
}

/*
 * -------------------------
 * Outputs
 * -------------------------
 */

export const dbIdentifier = database.identifier;

export const dbEndpoint = database.endpoint;

export const dbAvailabilityZone = database.availabilityZone;

export const albDnsName = loadBalancer.dnsName;

export const albArn = loadBalancer.arn;

export const targetGroupArn = targetGroup.arn;

export const listenerArn = listener.arn;

export const lambdaName = targetLambda.name;

export const natGatewayId = natGateway?.id ?? pulumi.output('');

export const natEipAllocationId = natEip?.id ?? pulumi.output('');

export const withNatEnabled = withNat;
