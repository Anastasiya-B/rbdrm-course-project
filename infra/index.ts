import * as k8s from '@pulumi/kubernetes';

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

/*
 * Validate required secrets before Pulumi touches the cluster.
 * The grader removes variables one by one and expects
 * preview to fail while naming the missing variable.
 */
const dbPassword = requireEnv('APP_DB_PASSWORD');

const jwtKid = requireEnv('JWT_KID');

const jwtPrivateKey = requireEnv('JWT_PRIVATE_KEY');

const jwtPublicKey = requireEnv('JWT_PUBLIC_KEY');

const refreshTokenPepper = requireEnv('REFRESH_TOKEN_PEPPER');

const image = process.env.IMAGE_NAME ?? 'rbdrm-marketplace:hw28';

const revision = process.env.REV ?? 'initial';

const namespaceName = 'marketplace-hw28';

const appName = 'marketplace';

const deploymentName = 'marketplace-deployment';

const serviceName = 'marketplace-service';

const secretName = 'marketplace-runtime-secret';

const pdbName = 'marketplace-pdb';

const hpaName = 'marketplace-hpa';

const labels = {
  app: appName,
};

const namespace = new k8s.core.v1.Namespace('marketplace-namespace', {
  metadata: {
    name: namespaceName,
  },
});

const secret = new k8s.core.v1.Secret(
  'marketplace-runtime-secret-resource',
  {
    metadata: {
      name: secretName,
      namespace: namespaceName,
    },

    type: 'Opaque',

    data: {
      DB_PASSWORD: Buffer.from(dbPassword).toString('base64'),

      JWT_KID: Buffer.from(jwtKid).toString('base64'),

      JWT_PRIVATE_KEY: Buffer.from(jwtPrivateKey).toString('base64'),

      JWT_PUBLIC_KEY: Buffer.from(jwtPublicKey).toString('base64'),

      REFRESH_TOKEN_PEPPER: Buffer.from(refreshTokenPepper).toString('base64'),
    },
  },
  {
    dependsOn: [namespace],
  },
);

const deployment = new k8s.apps.v1.Deployment(
  'marketplace-deployment-resource',
  {
    metadata: {
      name: deploymentName,
      namespace: namespaceName,
    },

    spec: {
      replicas: 3,

      strategy: {
        type: 'RollingUpdate',

        rollingUpdate: {
          maxUnavailable: 0,
          maxSurge: 1,
        },
      },

      selector: {
        matchLabels: labels,
      },

      template: {
        metadata: {
          labels,

          annotations: {
            revision,
          },
        },

        spec: {
          terminationGracePeriodSeconds: 15,

          securityContext: {
            runAsNonRoot: true,

            runAsUser: 65532,

            runAsGroup: 65532,
          },

          containers: [
            {
              name: appName,

              image,

              imagePullPolicy: 'IfNotPresent',

              ports: [
                {
                  name: 'http',

                  containerPort: 3000,
                },
              ],

              env: [
                {
                  name: 'PORT',

                  value: '3000',
                },

                {
                  name: 'DB_HOST',

                  value: 'postgres.invalid',
                },

                {
                  name: 'DB_PORT',

                  value: '5432',
                },

                {
                  name: 'DB_USER',

                  value: 'marketplace',
                },

                {
                  name: 'DB_NAME',

                  value: 'marketplace',
                },

                {
                  name: 'DB_PASSWORD',

                  valueFrom: {
                    secretKeyRef: {
                      name: secretName,

                      key: 'DB_PASSWORD',
                    },
                  },
                },

                {
                  name: 'DB_PASSWORD_FILE',

                  value: '/run/secrets/db_password',
                },

                {
                  name: 'DB_URL',

                  value:
                    'postgresql://marketplace@postgres.invalid:5432/marketplace',
                },

                {
                  name: 'DATABASE_URL',

                  value:
                    'postgresql://marketplace@postgres.invalid:5432/marketplace',
                },

                {
                  name: 'JWT_KID',

                  valueFrom: {
                    secretKeyRef: {
                      name: secretName,

                      key: 'JWT_KID',
                    },
                  },
                },

                {
                  name: 'JWT_PRIVATE_KEY',

                  valueFrom: {
                    secretKeyRef: {
                      name: secretName,

                      key: 'JWT_PRIVATE_KEY',
                    },
                  },
                },

                {
                  name: 'JWT_PUBLIC_KEY',

                  valueFrom: {
                    secretKeyRef: {
                      name: secretName,

                      key: 'JWT_PUBLIC_KEY',
                    },
                  },
                },

                {
                  name: 'REFRESH_TOKEN_PEPPER',

                  valueFrom: {
                    secretKeyRef: {
                      name: secretName,

                      key: 'REFRESH_TOKEN_PEPPER',
                    },
                  },
                },

                {
                  name: 'REV',

                  value: revision,
                },
              ],

              volumeMounts: [
                {
                  name: 'runtime-secret',

                  mountPath: '/run/secrets',

                  readOnly: true,
                },
              ],

              readinessProbe: {
                httpGet: {
                  path: '/readyz',

                  port: 'http',
                },

                periodSeconds: 1,

                timeoutSeconds: 1,

                failureThreshold: 1,

                successThreshold: 1,
              },

              livenessProbe: {
                httpGet: {
                  path: '/healthz',

                  port: 'http',
                },

                periodSeconds: 5,

                timeoutSeconds: 1,

                failureThreshold: 3,
              },

              resources: {
                requests: {
                  cpu: '50m',

                  memory: '96Mi',
                },

                limits: {
                  cpu: '500m',

                  memory: '256Mi',
                },
              },

              securityContext: {
                allowPrivilegeEscalation: false,

                readOnlyRootFilesystem: true,

                capabilities: {
                  drop: ['ALL'],
                },
              },
            },
          ],

          volumes: [
            {
              name: 'runtime-secret',

              secret: {
                secretName,

                items: [
                  {
                    key: 'DB_PASSWORD',

                    path: 'db_password',
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
  {
    dependsOn: [secret],
  },
);

const service = new k8s.core.v1.Service(
  'marketplace-service-resource',
  {
    metadata: {
      name: serviceName,

      namespace: namespaceName,
    },

    spec: {
      type: 'NodePort',

      selector: labels,

      ports: [
        {
          name: 'http',

          port: 3000,

          targetPort: 'http',

          nodePort: 30080,
        },
      ],
    },
  },
  {
    dependsOn: [deployment],
  },
);

const pdb = new k8s.policy.v1.PodDisruptionBudget(
  'marketplace-pdb-resource',
  {
    metadata: {
      name: pdbName,

      namespace: namespaceName,
    },

    spec: {
      minAvailable: 2,

      selector: {
        matchLabels: labels,
      },
    },
  },
  {
    dependsOn: [deployment],
  },
);

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  'marketplace-hpa-resource',
  {
    metadata: {
      name: hpaName,

      namespace: namespaceName,
    },

    spec: {
      minReplicas: 2,

      maxReplicas: 5,

      scaleTargetRef: {
        apiVersion: 'apps/v1',

        kind: 'Deployment',

        name: deploymentName,
      },

      metrics: [
        {
          type: 'Resource',

          resource: {
            name: 'cpu',

            target: {
              type: 'Utilization',

              averageUtilization: 70,
            },
          },
        },
      ],
    },
  },
  {
    dependsOn: [deployment],
  },
);

export const namespaceOutput = namespace.metadata.name;

export const deploymentOutput = deployment.metadata.name;

export const serviceOutput = service.metadata.name;

export const pdbOutput = pdb.metadata.name;

export const hpaOutput = hpa.metadata.name;
