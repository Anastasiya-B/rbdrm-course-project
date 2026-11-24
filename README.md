cost-gate-bypass-label: cost-approved

\# HW28–HW31 — Kubernetes, Observability & AWS Infrastructure

NestJS application deployed to a local \`kind\` cluster with Pulumi, rolling updates, readiness/liveness probes, PDB, HPA, runtime secrets, distroless Docker image, vulnerability scanning, structured logging, RED metrics, OpenTelemetry tracing and a provisioned Grafana dashboard.

\## Requirements

\- Docker

\- Node.js 22+

\- \`kubectl\`

\- \`kind\`

\- Pulumi CLI or \`npx pulumi\`

Install dependencies:

\`\`\`bash

npm ci

npm --prefix infra ci

\`\`\`

\## Environment

Commands requiring secrets use \`scripts/with-secrets.sh\`.

For grading without Infisical:

\`\`\`bash

export SKIP_VAULT=1

export APP_DB_PASSWORD="$(cat secrets/db_password)"

export PULUMI_BACKEND_URL="file://$PWD/.pulumi"

export PULUMI_CONFIG_PASSPHRASE="hw28-grading"

\`\`\`

Required runtime secrets:

\| Variable | Source |

\| ---------------------- | ------- |

\| \`APP_DB_PASSWORD\` | сховище |

\| \`JWT_KID\` | сховище |

\| \`JWT_PRIVATE_KEY\` | сховище |

\| \`JWT_PUBLIC_KEY\` | сховище |

\| \`REFRESH_TOKEN_PEPPER\` | сховище |

Example local auth values:

\`\`\`bash

export JWT_KID="hw28-local-key"

openssl genpkey \\

&#x20; -algorithm RSA \\

&#x20; -pkeyopt rsa_keygen_bits:2048 \\

&#x20; -out /tmp/hw28-private.pem

openssl rsa \\

&#x20; -pubout \\

&#x20; -in /tmp/hw28-private.pem \\

&#x20; -out /tmp/hw28-public.pem

export JWT_PRIVATE_KEY="$(openssl base64 -A -in /tmp/hw28-private.pem)"

export JWT_PUBLIC_KEY="$(openssl base64 -A -in /tmp/hw28-public.pem)"

export REFRESH_TOKEN_PEPPER="$(openssl rand -hex 32)"

\`\`\`

No new tracked \`.env\` file is required.

\## Production image

Build:

\`\`\`bash

npm run image:build

\`\`\`

The Dockerfile uses multiple stages and a distroless non-root runtime.

BuildKit receives \`.npm_token\` only through a secret mount. \`.npm_token\` is ignored by Git.

Verify:

\`\`\`bash

npm run demo:image

\`\`\`

Expected:

\`\`\`text

stages=3

shell-inside=0

runtime-uid=65532

token-in-history=0

token-in-config=0

token-in-layers=0

\`\`\`

\`demo:image\` checks the token in image history, image config and unpacked layer contents. Compressed gzip layers are decompressed before the token search.

\## Vulnerability scan

\`\`\`bash

npm run scan

\`\`\`

Current measured result:

\`\`\`text

image=rbdrm-marketplace:hw28

severity=HIGH,CRITICAL

found=9

max-allowed=10

gate=pass

\`\`\`

Gate checks:

\`\`\`bash

SCAN_MAX=-1 npm run scan

\`\`\`

Expected: non-zero exit code and \`gate=fail\`.

\`\`\`bash

SCAN_MAX=99999 npm run scan

\`\`\`

Expected: exit code \`0\` and \`gate=pass\`.

CI workflow:

\`\`\`text

.github/workflows/hw28-security.yml

\`\`\`

It builds the image, verifies the image contract and runs the vulnerability scan.

\## Kubernetes

Local cluster:

\`\`\`bash

npm run cluster:up

\`\`\`

The image is loaded into \`kind\` after build.

Local platform:

\`\`\`text

Docker Desktop + kind on macOS

\`\`\`

Check Docker/kind memory:

\`\`\`bash

docker info --format '{{.MemTotal}}' \\

&#x20; \| awk '{printf "%.2f GiB\n", $1/1024/1024/1024}'

\`\`\`

Docker/kind available memory on the development machine:

\`\`\`text

7.65 GiB

\`\`\`

Deploy with Pulumi:

\`\`\`bash

npm run up

\`\`\`

Pulumi creates:

\- Namespace

\- Secret

\- Deployment

\- Service

\- PodDisruptionBudget

\- HorizontalPodAutoscaler

Main configuration:

\`\`\`text

replicas=3

maxUnavailable=0

maxSurge=1

terminationGracePeriodSeconds=15

readiness=/readyz

liveness=/healthz

PDB minAvailable=2

HPA minReplicas=2

HPA maxReplicas=5

HPA CPU target=70%

\`\`\`

\### Deployment replicas and HPA ownership

The Deployment starts with \`replicas=3\` so a fresh installation immediately satisfies the availability requirements.

After deployment, HPA owns runtime scaling between \`2\` and \`5\` replicas.

\`spec.replicas\` therefore has two potential owners: Pulumi and the HPA controller. Pulumi ignores subsequent changes to \`spec.replicas\` after initial creation so it does not fight HPA scaling decisions.

Check:

\`\`\`bash

kubectl -n marketplace-hw28 get pods

kubectl -n marketplace-hw28 get deploy marketplace-deployment

kubectl -n marketplace-hw28 get svc marketplace-service

kubectl -n marketplace-hw28 get pdb marketplace-pdb

kubectl -n marketplace-hw28 get hpa marketplace-hpa

\`\`\`

On local \`kind\` without Metrics Server, HPA CPU may show:

\`\`\`text

cpu: \<unknown>/70%

\`\`\`

This is expected.

Health endpoints:

\`\`\`bash

curl http\://127.0.0.1:30080/healthz

curl http\://127.0.0.1:30080/readyz

\`\`\`

Expected:

\`\`\`json

{ "status": "alive" }

\`\`\`

\`\`\`json

{ "status": "ready" }

\`\`\`

\## Graceful shutdown

On \`SIGTERM\` the application:

\`\`\`text

mark not ready

→ wait 5 seconds for draining

→ close HTTP server

→ exit

\`\`\`

Kubernetes termination grace period is \`15s\`, which is longer than the \`5s\` drain period.

\## Zero-downtime rollout

Run:

\`\`\`bash

npm run demo:rollout

\`\`\`

The demo performs a real Pulumi revision change while HTTP traffic is running.

Each HTTP response code is written to a temporary evidence file, one code per line. \`requests\`, \`ok\` and \`failed\` are calculated from that file rather than only from in-memory counters.

Example evidence:

\`\`\`text

200

200

200

200

\`\`\`

Transport errors are recorded as:

\`\`\`text

0

\`\`\`

Measured result:

\`\`\`text

profile=correct

requests=50809

ok=50809

failed=0

rollout-seconds=61

\`\`\`

Acceptance requirement:

\`\`\`text

requests >= 5000

failed=0

\`\`\`

\## PodDisruptionBudget

Run:

\`\`\`bash

npm run demo:pdb

\`\`\`

Expected measured output:

\`\`\`text

healthy=3

minAvailable=2

evict-1=201

evict-2=429

\`\`\`

The first request uses the Kubernetes Eviction API successfully. The second is rejected by the PDB because evicting another pod would violate \`minAvailable=2\`.

\## Runtime secrets

Pulumi creates a Kubernetes \`Secret\`.

Sensitive values are referenced from the Deployment through \`secretKeyRef\`.

\`APP_DB_PASSWORD\` is also mounted as:

\`\`\`text

/run/secrets/db_password

\`\`\`

for the existing \`DB_PASSWORD_FILE\` configuration.

Secret values are not placed directly in the Deployment environment specification.

In production, an External Secrets Operator or Secrets Store CSI Driver would normally synchronize secrets from an external secret manager.

\## Pulumi backend

Local file backend:

\`\`\`bash

mkdir -p .pulumi

export PULUMI_BACKEND_URL="file://$PWD/.pulumi"

export PULUMI_CONFIG_PASSPHRASE="hw28-grading"

\`\`\`

Pulumi commands:

\`\`\`bash

npm run up

npm run destroy

\`\`\`

\## Observability

HW29 adds structured JSON logging, RED metrics, OpenTelemetry tracing and a provisioned Grafana dashboard.

\### Runtime variables

\| Variable | Purpose | Source |

\| ----------------------------- | ----------------------------- | ------------------------------------------------ |

\| \`OTEL_EXPORTER_OTLP_ENDPOINT\` | OTLP HTTP endpoint for traces | \`scripts/with-secrets.sh\` / exported environment |

\| \`PROMETHEUS_URL\` | Prometheus API endpoint | \`scripts/with-secrets.sh\` / exported environment |

\| \`TRACE_API_URL\` | Tempo trace API endpoint | \`scripts/with-secrets.sh\` / exported environment |

\| \`GRAFANA_USER\` | Grafana username | \`scripts/with-secrets.sh\` / exported environment |

\| \`GRAFANA_PASSWORD\` | Grafana password | \`scripts/with-secrets.sh\` / exported environment |

No additional HW29 \`.env\` file is required.

\### Structured logs

Application request logs are emitted as JSON using Pino.

The correlation identifier is the active OpenTelemetry \`trace_id\`, not a separately generated UUID.

Request-scoped values such as \`userId\`, \`tenant\` and \`idempotencyKey\` are stored in \`AsyncLocalStorage\`.

The observability request crosses at least three logged layers:

\- \`orders.controller\`

\- \`orders.service\`

\- \`orders.repo\`

The same \`trace_id\` is preserved across all three layers.

Authorization tokens and passwords are redacted before log output.

Latest verified \`demo:logs\` result:

\`\`\`text

non-json-lines=0

layers=3

distinct-trace-ids=1

trace-id-matches-header=1

burst=8

burst-trace-ids=8

burst-uneven=0

secret-req-logged=1

secret-in-logs=0

\`\`\`

The demo was run three times consecutively with the same result.

\### RED metrics

Metrics are exposed at:

\`\`\`text

/metrics

\`\`\`

The \`route\` label uses the route template, for example:

\`\`\`text

/observability/orders/:id

\`\`\`

rather than a raw URL containing a concrete id.

\#### Rate

Question: how much traffic is the service receiving?

\`\`\`promql

sum(rate(http_requests_total[1m]))

\`\`\`

\#### Errors

Question: how many HTTP 5xx responses are occurring?

\`\`\`promql

sum(rate(http_requests_total{status=\~"5.."}[1m]))

\`\`\`

\#### Duration

Question: how long are requests taking?

\`\`\`promql

histogram_quantile(

&#x20; 0.95,

&#x20; sum by (le) (

&#x20; rate(http_request_duration_seconds_bucket[1m])

&#x20; )

)

\`\`\`

Histogram bucket boundaries:

\`\`\`text

0.005

0.01

0.025

0.05

0.1

0.25

0.5

1

2.5

5

10

\`\`\`

The largest finite bucket is \`10\` seconds.

\`demo:metrics\` verifies bucket coverage by calculating:

\`\`\`text

\_count - \_bucket{le="10"}

\`\`\`

and requires:

\`\`\`text

above-top-bucket=0

\`\`\`

Latest verified result:

\`\`\`text

sent-ok=40

sent-fail=10

counter-delta=50

errors-delta=10

above-top-bucket=0

series-before=3

series-after=3

\`\`\`

The demo was run three times consecutively with the same result.

\### OpenTelemetry tracing

Incoming W3C \`traceparent\` headers are continued by OpenTelemetry.

The trace demo compares the same request across:

1\. the trace id supplied in \`traceparent\`;

2\. \`trace_id\` in the structured application log;

3\. the trace id exported to the trace backend.

The demo also verifies that:

\- the trace contains at least two spans;

\- child spans are connected;

\- an HTTP 500 request produces a span with ERROR status.

Latest verified \`demo:trace\` result:

\`\`\`text

spans=11

orphan-spans=0

trace-matches-header=1

trace-matches-log=1

span-status-error=1

\`\`\`

\### Local observability stack

\| Component | Address |

\| --------------- | ------------------------ |

\| Grafana | \`http\://127.0.0.1:22900\` |

\| Prometheus | \`http\://127.0.0.1:22901\` |

\| Tempo trace API | \`http\://127.0.0.1:22904\` |

\| OTLP HTTP | \`http\://127.0.0.1:22918\` |

The Grafana datasource and dashboard are provisioned from repository files.

Dashboard:

\`\`\`text

observability/grafana/dashboards/marketplace-observability.json

\`\`\`

The dashboard contains three RED panels:

\- request rate;

\- HTTP 5xx error rate;

\- p95 request duration.

\## Grading

Run from a fresh clone.

\### 1. Prepare local untracked files

\`\`\`bash

mkdir -p secrets

mkdir -p .pulumi

printf '%s' 'hw28-grading-password' > secrets/db_password

printf '%s' 'hw28-build-bait-token' > .npm_token

\`\`\`

\`secrets/\`, \`.npm_token\` and \`.pulumi/\` are ignored by Git.

\### 2. Export grading environment

\`\`\`bash

export SKIP_VAULT=1

export APP_DB_PASSWORD="$(cat secrets/db_password)"

export PULUMI_BACKEND_URL="file://$PWD/.pulumi"

export PULUMI_CONFIG_PASSPHRASE="hw28-grading"

export JWT_KID="grader"

openssl genpkey \\

&#x20; -algorithm RSA \\

&#x20; -pkeyopt rsa_keygen_bits:2048 \\

&#x20; -out /tmp/hw29-private.pem

openssl rsa \\

&#x20; -pubout \\

&#x20; -in /tmp/hw29-private.pem \\

&#x20; -out /tmp/hw29-public.pem

export JWT_PRIVATE_KEY="$(openssl base64 -A -in /tmp/hw29-private.pem)"

export JWT_PUBLIC_KEY="$(openssl base64 -A -in /tmp/hw29-public.pem)"

export REFRESH_TOKEN_PEPPER="$(openssl rand -hex 32)"

export OTEL_EXPORTER_OTLP_ENDPOINT=http\://127.0.0.1:22918

export PROMETHEUS_URL=http\://127.0.0.1:22901

export TRACE_API_URL=http\://127.0.0.1:22904

\`\`\`

If the local database is started from the repository Docker Compose stack, use:

\`\`\`bash

export DB_HOST=127.0.0.1

export DB_PORT=5432

export DB_USER=marketplace

export DB_PASSWORD=marketplace_password

export DB_NAME=marketplace

export DB_URL="postgresql://marketplace:marketplace_password\@127.0.0.1:5432/marketplace"

\`\`\`

\### 3. Install dependencies

\`\`\`bash

npm ci

npm --prefix infra ci

\`\`\`

\### 4. HW28 image and security checks

\`\`\`bash

npm run image:build

npm run demo:image

\`\`\`

Check scan gate:

\`\`\`bash

set +e

SCAN_MAX=-1 npm run scan

NEGATIVE_SCAN_EXIT=$?

set -e

test "$NEGATIVE_SCAN_EXIT" -ne 0

SCAN_MAX=99999 npm run scan

\`\`\`

\### 5. Start application dependencies

\`\`\`bash

docker compose up -d --wait

\`\`\`

\### 6. Start observability stack

\`\`\`bash

docker compose \\

&#x20; -f observability/docker-compose.yml \\

&#x20; up -d --wait

\`\`\`

The observability stack uses ports in the \`22900–22999\` range.

Verify:

\`\`\`bash

curl -s http\://127.0.0.1:22901/-/ready

curl -s http\://127.0.0.1:22900/api/health

\`\`\`

\### 7. Compile

\`\`\`bash

npx tsc --noEmit

npm run build

\`\`\`

\### 8. Run HW29 acceptance demos

\`\`\`bash

npm run demo:logs

npm run demo:metrics

npm run demo:trace

\`\`\`

Expected \`demo:logs\` invariants:

\`\`\`text

non-json-lines=0

layers>=3

distinct-trace-ids=1

trace-id-matches-header=1

burst>=8

burst-trace-ids=burst

burst-uneven=0

secret-req-logged=1

secret-in-logs=0

\`\`\`

Expected \`demo:metrics\` invariants:

\`\`\`text

sent-ok + sent-fail >= 50

counter-delta = sent-ok + sent-fail

errors-delta = sent-fail

above-top-bucket=0

series-after = series-before

\`\`\`

Expected \`demo:trace\` invariants:

\`\`\`text

spans>=2

orphan-spans=0

trace-matches-header=1

trace-matches-log=1

span-status-error=1

\`\`\`

The three demo scripts are invoked through \`scripts/with-secrets.sh\`.

\### 9. HW28 Kubernetes acceptance

Create cluster and deploy:

\`\`\`bash

npm run cluster:up

npm run up

\`\`\`

Verify resources:

\`\`\`bash

kubectl -n marketplace-hw28 get pods

kubectl -n marketplace-hw28 get deploy marketplace-deployment

kubectl -n marketplace-hw28 get svc marketplace-service

kubectl -n marketplace-hw28 get pdb marketplace-pdb

kubectl -n marketplace-hw28 get hpa marketplace-hpa

\`\`\`

Run acceptance demos:

\`\`\`bash

npm run demo:rollout

npm run demo:pdb

\`\`\`

\### 10. Final checks

\`\`\`bash

npx tsc --noEmit

npm --prefix infra run typecheck

git diff --check

\`\`\`

Check that the HW29 demo scripts use the secret wrapper:

\`\`\`bash

node -e "

const s=require('./package.json').scripts;

const need=['demo:logs','demo:metrics','demo:trace'];

const bad=need.filter(k=>/with-secrets\\\\.sh/.test(s[k]||'')===false);

console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));

process.exit(bad.length===0?0:1);

"

\`\`\`

Expected:

\`\`\`text

OK

\`\`\`

\### 11. Cleanup

\`\`\`bash

docker compose \\

&#x20; -f observability/docker-compose.yml \\

&#x20; down

npm run destroy

npm run cluster:down

docker compose down

\`\`\`

\## Structure

\`\`\`text

docker/

&#x20; Dockerfile

infra/

&#x20; index.ts

&#x20; package.json

&#x20; package-lock.json

&#x20; Pulumi.yaml

&#x20; tsconfig.json

k8s/

&#x20; kind-config.yaml

observability/

&#x20; docker-compose.yml

&#x20; prometheus/

&#x20; prometheus.yml

&#x20; grafana/

&#x20; dashboards/

&#x20; marketplace-observability.json

&#x20; provisioning/

&#x20; dashboards/

&#x20; marketplace.yml

&#x20; datasources/

&#x20; marketplace.yml

demo/

&#x20; demo-image.sh

&#x20; demo-rollout.sh

&#x20; demo-pdb.sh

&#x20; rollout-load.mjs

&#x20; demo-logs.sh

&#x20; demo-logs.mjs

&#x20; demo-metrics.sh

&#x20; demo-metrics.mjs

&#x20; demo-trace.sh

&#x20; demo-trace.mjs

src/

&#x20; observability/

&#x20; context.ts

&#x20; logger.ts

&#x20; metrics.ts

&#x20; metrics.controller.ts

&#x20; metrics.interceptor.ts

&#x20; observability.controller.ts

&#x20; observability.service.ts

&#x20; orders.repository.ts

&#x20; request-context.middleware.ts

&#x20; telemetry.ts

scripts/

&#x20; cluster-up.sh

&#x20; cluster-down.sh

&#x20; pulumi-up.sh

&#x20; pulumi-destroy.sh

&#x20; scan-image.sh

&#x20; with-secrets.sh

.github/workflows/

&#x20; hw28-security.yml

\`\`\`

\## AWS

смуга: основна

teardown-run: \`https\://github.com/Anastasiya-B/rbdrm-course-project/actions/runs/45385253496\`

region: \`eu-north-1\` (Europe/Stockholm)

HW31 uses real AWS resources managed by Pulumi. The infrastructure is split into two stacks so that resources with hourly cost exist only for the duration of the demo:

\- \`base\` — AWS Budget, VPC, 2 public + 2 private subnets across two AZs, IGW, route tables, security groups and GitHub OIDC/IAM. No hourly resources.

\- \`demo\` — RDS PostgreSQL Multi-AZ instance, internet-facing ALB with Lambda target, and an optional NAT Gateway controlled by \`withNat\`.

\### AWS account and cost guardrail

The work was performed on the AWS Free plan without upgrading to Paid. The first AWS resource in \`base\` is a monthly COST budget with a \`$5\` limit and an ACTUAL notification at 20% using \`GREATER_THAN\` and \`PERCENTAGE\`.

The budget is an alert, not an immediate circuit breaker. The real guardrail for this homework is short-lived \`demo\` infrastructure plus the scheduled/manual teardown workflow.

\### Pricing

Pricing sources checked on **\*\*2026-11-23\*\***:

\- AWS Elastic Load Balancing pricing: hourly or partial-hour ALB charge plus LCU usage.

\- Amazon VPC pricing: NAT Gateway is billed per provisioned hour or partial hour, plus data processing; public IPv4 is billed separately.

\- Course reference snapshot dated **\*\*2026-08-24\*\*** gives the exact Frankfurt (\`eu-central-1\`) reference rates used by the assignment and notes that the same stack in Stockholm was about 9.8% cheaper in that comparison.

For the actual homework region \`eu-north-1\`, the table below uses the assignment's Stockholm comparison as the course reference. It is an estimate for the exercise, not a production quote; AWS pricing should be rechecked before production use.

\| Item | eu-north-1 course reference | Billing note |

\| -------------------------------------- | ------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------ |

\| ALB | ≈ \`$0.02395/hour\` | Derived from the assignment's Stockholm comparison (≈11.3% below \`$0.02700/hour\` Frankfurt reference); LCU is additional. |

\| RDS \`db.t4g.micro\` PostgreSQL Multi-AZ | ≈ \`$0.03293/hour\` | Derived from the assignment's Stockholm comparison (≈11% below \`$0.03700/hour\` Frankfurt reference). |

\| Public IPv4 × 2 for ALB | \`$0.01000/hour\` | \`$0.00500/hour\` per public IPv4; assignment notes this does not change between Frankfurt and Stockholm. |

\| gp3 20 GiB, Multi-AZ | regional monthly storage charge | Storage is charged separately from the DB instance; the assignment's Frankfurt snapshot was \`$0.274/GiB-month\`. |

\| NAT Gateway, optional demo only | ≈ \`$0.04602/hour\` + IPv4 | Derived from the assignment's Stockholm comparison (≈11.5% below \`$0.052/hour\` Frankfurt reference). Partial NAT hours are billed as full hours. |

The assignment's reference full stack was \`$0.08191/hour\` in Frankfurt. Applying its documented 9.8% Stockholm difference gives an exercise reference of approximately \`$0.07387/hour\` for the comparable Stockholm stack before any different real traffic/LCU usage.

The NAT measurement was intentionally short-lived:

\`\`\`text

nat-minutes=5

nat-billed-hours=1

\`\`\`

The values differ because AWS bills each partial NAT Gateway hour as a full hour.

\### Network

Verified \`base\` evidence:

\`\`\`text

vpc-id=vpc-0aea289813a3a9ed4

public-subnets=2

private-subnets=2

subnet-azs=2

private-default-route=0

security-groups=3

tagged-resources=16

\`\`\`

The private route table has no \`0.0.0.0/0\` route to the Internet Gateway. NAT is not part of the permanent \`base\` stack.

Default tags are applied through the AWS Pulumi provider:

\`\`\`text

Project=nodejs-pro-hw31

Stack=\<base|demo>

ManagedBy=pulumi

\`\`\`

\### GitHub OIDC and IAM

GitHub Actions authenticates to AWS with \`sts:AssumeRoleWithWebIdentity\` through the GitHub OIDC provider:

\`\`\`text

https\://token.actions.githubusercontent.com

\`\`\`

The trust policy restricts the audience to:

\`\`\`text

sts.amazonaws.com

\`\`\`

and the subject to this repository:

\`\`\`text

repo:Anastasiya-B/rbdrm-course-project:\*

\`\`\`

The teardown permission policy intentionally contains no wildcard \`Action\`. \`Resource: "\*"\` is used where the AWS APIs used by teardown/verification do not support practical resource-level restriction for this exercise.

Each permission is used for one of the following teardown or verification operations:

\| IAM Action | Why it is required |

\| -------------------------------------------- | ----------------------------------------------------------------- |

\| \`ec2:DescribeAccountAttributes\` | Read EC2 account/network attributes used by the provider. |

\| \`ec2:DescribeAddresses\` | Verify and release Elastic IP addresses. |

\| \`ec2:DescribeAvailabilityZones\` | Read AZ metadata for the VPC/subnets. |

\| \`ec2:DescribeInternetGateways\` | Read IGW state before deletion. |

\| \`ec2:DescribeNatGateways\` | Verify NAT state and final \`nat-left\` count. |

\| \`ec2:DescribeNetworkInterfaces\` | Inspect ENIs that can block VPC/SG deletion. |

\| \`ec2:DescribeRouteTables\` | Read route tables before teardown. |

\| \`ec2:DescribeSecurityGroups\` | Read security groups before teardown. |

\| \`ec2:DescribeSubnets\` | Read subnet state before teardown. |

\| \`ec2:DescribeTags\` | Read AWS tags used by Pulumi/provider teardown. |

\| \`ec2:DescribeVpcAttribute\` | Read VPC attributes used by the provider. |

\| \`ec2:DescribeVpcs\` | Read/verify the VPC; this is the positive IAM simulation action. |

\| \`ec2:DeleteNatGateway\` | Delete the optional NAT Gateway. |

\| \`ec2:ReleaseAddress\` | Release the NAT Elastic IP. |

\| \`ec2:DeleteRoute\` | Remove the optional private default route. |

\| \`ec2:DisassociateRouteTable\` | Remove subnet/route-table associations. |

\| \`ec2:DeleteRouteTable\` | Delete route tables. |

\| \`ec2:DeleteSubnet\` | Delete public/private subnets. |

\| \`ec2:DetachInternetGateway\` | Detach the IGW from the VPC. |

\| \`ec2:DeleteInternetGateway\` | Delete the IGW. |

\| \`ec2:DeleteSecurityGroup\` | Delete ALB/app/RDS security groups. |

\| \`ec2:DeleteVpc\` | Delete the VPC. |

\| \`rds:DescribeDBInstances\` | Read RDS state and calculate \`rds-left\`. |

\| \`rds:DescribeDBSubnetGroups\` | Read the DB subnet group before deletion. |

\| \`rds:DescribeEvents\` | Read RDS failover events. |

\| \`rds:ListTagsForResource\` | Read RDS tags during provider operations. |

\| \`rds:DeleteDBInstance\` | Delete the demo PostgreSQL instance. |

\| \`rds:DeleteDBSubnetGroup\` | Delete the DB subnet group. |

\| \`elasticloadbalancing:DescribeListeners\` | Read ALB listeners. |

\| \`elasticloadbalancing:DescribeLoadBalancers\` | Read ALB state and calculate \`alb-left\`. |

\| \`elasticloadbalancing:DescribeTags\` | Read ALB tags. |

\| \`elasticloadbalancing:DescribeTargetGroups\` | Read target-group state. |

\| \`elasticloadbalancing:DescribeTargetHealth\` | Verify target health. |

\| \`elasticloadbalancing:DeregisterTargets\` | Remove Lambda target registration. |

\| \`elasticloadbalancing:DeleteListener\` | Delete the HTTP listener. |

\| \`elasticloadbalancing:DeleteTargetGroup\` | Delete the target group. |

\| \`elasticloadbalancing:DeleteLoadBalancer\` | Delete the ALB. |

\| \`lambda:GetFunction\` | Read Lambda function state. |

\| \`lambda:GetFunctionConfiguration\` | Read Lambda configuration. |

\| \`lambda:GetPolicy\` | Read Lambda resource policy. |

\| \`lambda:ListTags\` | Read Lambda tags. |

\| \`lambda:RemovePermission\` | Remove ALB invoke permission. |

\| \`lambda:DeleteFunction\` | Delete the Lambda target. |

\| \`iam:GetRole\` | Read IAM roles. |

\| \`iam:GetRolePolicy\` | Read inline role policies. |

\| \`iam:GetOpenIDConnectProvider\` | Read the GitHub OIDC provider. |

\| \`iam:ListRolePolicies\` | Enumerate inline role policies before role deletion. |

\| \`iam:ListAttachedRolePolicies\` | Enumerate managed policies attached to the demo Lambda role. |

\| \`iam:DetachRolePolicy\` | Detach \`AWSLambdaBasicExecutionRole\`. |

\| \`iam:DeleteRolePolicy\` | Delete the teardown inline policy. |

\| \`iam:DeleteRole\` | Delete IAM roles created by the stacks. |

\| \`iam:DeleteOpenIDConnectProvider\` | Delete the GitHub OIDC provider. |

\| \`budgets:ViewBudget\` | Read the HW31 budget. |

\| \`budgets:ModifyBudget\` | Authorize budget modification/deletion during teardown. |

\| \`aws-portal:ViewBilling\` | Billing/budget read authorization used by the budget API. |

\| \`aws-portal:ModifyBilling\` | Billing/budget modification authorization used by the budget API. |

\| \`tag:GetResources\` | Count tagged project resources after teardown. |

\`simulate-principal-policy\` evidence:

\`\`\`text

sim-allowed=allowed

sim-denied=implicitDeny

\`\`\`

The positive simulation uses \`ec2:DescribeVpcs\`. The negative simulation uses \`s3:PutObject\`, which is intentionally absent from the teardown role.

\### RDS Multi-AZ versus my HW15 database stack

In HW15 I was responsible for the database topology myself: primary/replica roles, connection routing through PgBouncer and the backup script were application/infrastructure responsibilities. With RDS Multi-AZ instance deployment, AWS takes over provisioning and maintaining the standby instance in another AZ, replication required by the Multi-AZ service, infrastructure-level failover, instance replacement, managed backups/retention and much of the underlying database host maintenance.

RDS does **\*\*not\*\*** take over application-level responsibilities. The application still owns schema/migrations, credentials and secret handling, connection-pool configuration, retry/reconnect behaviour during failover, observability, query/index performance, data-retention policy and restore testing. If PgBouncer or another application-level pool/proxy is required by the workload, that is still an architectural choice rather than something Multi-AZ automatically replaces.

Measured failover evidence:

\`\`\`text

az-before=eu-north-1b

az-after=eu-north-1a

failover-seconds=79

event=Multi-AZ instance failover completed

\`\`\`

\### ALB demo

The ALB is internet-facing and spans the two public subnets. Its target is a Lambda function, which avoids adding an EC2 instance and another public IPv4 line to the homework bill.

Measured evidence:

\`\`\`text

alb-dns=hw31-alb-6319a9a-276409093.eu-north-1.elb.amazonaws.com

http-code=200

target-state=healthy

\`\`\`

\### KMS and secrets

KMS is not a replacement for the secret-storage approach from HW11. It is a cryptographic layer underneath secret storage: a secret such as an application \`ENCRYPTION_KEY\` can itself be encrypted with a KMS key, while the secret manager/vault still owns secret storage, access workflow, rotation and delivery to the application.

This homework does not create a customer-managed KMS key because it is unnecessary for the acceptance criteria and would introduce another billable resource that can outlive a short demo. RDS storage encryption is enabled using the service-supported encryption path without creating a dedicated CMK for HW31.

\### Pulumi state backend: HW28 versus HW31

HW28 used a local file backend:

\`\`\`text

file://$PWD/.pulumi

\`\`\`

That was appropriate for a local \`kind\` environment because deployment and teardown ran from the same development machine.

HW31 uses Pulumi Cloud:

\`\`\`text

https\://app.pulumi.com

\`\`\`

with stacks:

\`\`\`text

zona2406-gmail-com-org/rbdrm-hw31-base/dev

zona2406-gmail-com-org/rbdrm-hw31-demo/dev

\`\`\`

The difference is intentional: the scheduled/manual GitHub Actions teardown runs on an ephemeral GitHub runner, so a state file stored only on the development laptop would not be accessible to CI. Pulumi Cloud provides the shared state required for \`pulumi destroy\` from both local development and GitHub Actions.

GitHub Actions authenticates to Pulumi Cloud using GitHub OIDC and a short-lived Pulumi token rather than a long-lived AWS access key.

\### HW31 evidence

Repository evidence:

\`\`\`text

evidence/base.txt

evidence/base-state.json

evidence/iam.json

evidence/iam.txt

evidence/demos.txt

\`\`\`

Current demo evidence:

\`\`\`text

alb-dns=hw31-alb-6319a9a-276409093.eu-north-1.elb.amazonaws.com

http-code=200

target-state=healthy

az-before=eu-north-1b

az-after=eu-north-1a

failover-seconds=79

event=Multi-AZ instance failover completed

nat-minutes=5

nat-billed-hours=1

\`\`\`

The GitHub Actions teardown run is the authoritative external teardown proof. The accepted final run must print:

\`\`\`text

state-resources-left=0

tagged-resources-left=0

rds-left=0

alb-left=0

nat-left=0

eip-left=0

\`\`\`

\### HW31 commands

All fixed HW31 scripts are invoked through \`scripts/with-secrets.sh\`:

\`\`\`bash

npm run up:base

npm run up:demo

npm run demo:alb

npm run demo:failover

npm run demo:nat

npm run destroy:demo

npm run destroy:base

\`\`\`

The teardown workflow is available at:

\`\`\`text

.github/workflows/teardown.yml

\`\`\`

It supports both nightly \`schedule\` execution and manual \`workflow_dispatch\` execution with AWS OIDC authentication.

\## Submission

Branch:

\`\`\`text

hw-29

\`\`\`

Submit a Pull Request from \`hw-29\`.

The \`OpenTelemetry tracing\` section contains the latest verified passing \`demo:trace\` numbers.

## CI/CD

HW32 implements a pull-request CI pipeline and a manual deployment pipeline.

The PR pipeline is defined in:

```text
.github/workflows/pr.yml
```

It performs the following stages:

```text
quality gates
→ build exactly once
→ push image to GHCR
→ promote by sha256 digest
→ create local kind cluster
→ Pulumi preview
→ cost gate
→ GitHub OIDC verification
→ Pulumi up
→ rollout verification
→ pipeline evidence
```

The deployment pipeline is defined in:

```text
.github/workflows/deploy.yml
```

It does not rebuild the container image. It accepts an existing GHCR image reference and immutable `sha256:` digest and deploys exactly that digest.

### Quality gates

The pipeline contains four bidirectional quality gates.

| Gate                  | Tool                         | Valid input            | Intentionally broken input |
| --------------------- | ---------------------------- | ---------------------- | -------------------------- |
| Type/style            | TypeScript + ESLint          | exit `0`               | non-zero                   |
| API contract          | oasdiff                      | exit `0`               | non-zero                   |
| Architecture          | dependency-cruiser           | exit `0`               | non-zero                   |
| Image vulnerabilities | Trivy through `npm run scan` | `SCAN_MAX=99999` → `0` | `SCAN_MAX=-1` → non-zero   |

Run all four demonstrations locally:

```bash
npm run demo:gates
```

Expected contract:

```text
types-style-ok=0
types-style-broken!=0
contract-ok=0
contract-broken!=0
architecture-ok=0
architecture-broken!=0
image-scan-ok=0
image-scan-broken!=0
```

### OIDC gate

GitHub Actions receives `id-token: write` only on jobs that require an OIDC token.

The pipeline fetches GitHub's OpenID Connect discovery document and JWKS, then verifies the JWT locally using:

```text
scripts/hw32/oidc-gate.mjs
oidc/policy.json
```

The JWT itself is never printed.

The policy validates:

```text
signature
iss
aud
sub
exp
nbf
```

The local OIDC demonstration uses the same verification code as CI:

```bash
npm run demo:oidc
```

Expected result:

```text
case=green
sig-verified=1
policy-allow=1
case=foreign-sub
sig-verified=1
policy-allow=0
case=bad-signature
sig-verified=0
policy-allow=0
```

### Build once and promote by digest

The image is built only once in the PR pipeline.

The human-readable tag is based on the PR HEAD commit SHA:

```text
ghcr.io/anastasiya-b/rbdrm-course-project:<head-sha>
```

Deployment never relies on that mutable tag alone. The build job exports the registry digest and the deployment uses:

```text
<image-ref>@sha256:<digest>
```

The resulting deployment manifest is checked again and its digest is recorded in `evidence.txt`.

### Cost gate

The cost gate reads the Pulumi preview JSON and estimates monthly compute cost from Kubernetes Deployment resource requests.

Pricing rates used by `src/mapping.ts`:

```text
CPU:    0.04048 USD per vCPU-hour
Memory: 0.004445 USD per GiB-hour
Month:  730 hours
```

The model intentionally uses AWS Fargate Linux/x86 On-Demand rates from US East (N. Virginia) as a stable public reference for converting requested CPU and memory into a comparable monthly amount.

Pricing source:

```text
https://aws.amazon.com/fargate/pricing/
```

AWS documents Fargate pricing as based on requested vCPU and memory. The reference rates used by this project are `$0.04048` per vCPU-hour and `$0.004445` per GB-hour.

The local gate can be demonstrated with:

```bash
PLAN_JSON=fixtures/hw32/cost/plan.json \
COST_BUDGET_USD=0 \
npm run gate:cost
```

Expected: non-zero exit and:

```text
gate=fail
```

A permissive budget:

```bash
PLAN_JSON=fixtures/hw32/cost/plan.json \
COST_BUDGET_USD=999999 \
npm run gate:cost
```

Expected:

```text
gate=pass
```

A pull request may bypass the budget only through the explicitly named label:

```text
cost-approved
```

The bypass is visible in pipeline logs and does not disable Pulumi preview.

### Secrets

Application secrets continue to use the existing HW11 secret-storage flow through:

```text
scripts/with-secrets.sh
```

For grading and ephemeral CI environments:

```text
SKIP_VAULT=1
```

allows already-provided runtime variables to pass through the same wrapper without requiring access to the developer's сховище.

| Variable               | Source / сховище                                    | Purpose                                |
| ---------------------- | --------------------------------------------------- | -------------------------------------- |
| `APP_DB_PASSWORD`      | HW11 сховище; ephemeral runtime value in CI/grading | Kubernetes application database secret |
| `JWT_KID`              | HW11 сховище; ephemeral runtime value in CI/grading | JWT signing key identifier             |
| `JWT_PRIVATE_KEY`      | HW11 сховище; ephemeral runtime value in CI/grading | JWT private signing key                |
| `JWT_PUBLIC_KEY`       | HW11 сховище; ephemeral runtime value in CI/grading | JWT verification key                   |
| `REFRESH_TOKEN_PEPPER` | HW11 сховище; ephemeral runtime value in CI/grading | refresh-token hashing pepper           |
| `PACT_BROKER_URL`      | GitHub secret or local broker URL                   | Pact Broker endpoint                   |
| `PACT_BROKER_TOKEN`    | GitHub secret / сховище                             | Pact Broker authentication             |

No AWS access key, registry password, or other long-lived cloud credential is required for HW32.

GitHub registry authentication uses the ephemeral:

```text
GITHUB_TOKEN
```

GitHub OIDC credentials are also ephemeral and are requested only by jobs with job-level:

```yaml
permissions:
  id-token: write
```

GitHub masking is defense in depth, not a substitute for safe logging. Secret-aware steps therefore do not use `set -x`, `env`, `printenv`, or commands that echo secret values. A secret should be treated as exposed if workflow code explicitly prints it, even if the CI platform might mask the output.

### Pipeline evidence

Every PR pipeline run uploads an artifact named exactly:

```text
pipeline-evidence
```

The artifact contains:

```text
evidence.txt
deployment.json
plan.json
rollout.txt
build.log
```

`evidence.txt` records:

```text
run-id
head-sha
image-ref
built-digest
deployed-digest
build-invocations
creds-source
oidc-iss
oidc-aud
oidc-sub
oidc-sig-verified
rollout-requests
rollout-ok
rollout-failed
rollout-seconds
secret-in-manifest
gate-scan-exit
```

The evidence artifact is uploaded with `if: always()` so failed runs still retain diagnostic evidence when files were produced.

## Grading

Run from the repository root.

```bash
export SKIP_VAULT=1

export APP_DB_PASSWORD=grader-secret
export JWT_KID=grader
export JWT_PRIVATE_KEY=grader-private-key
export JWT_PUBLIC_KEY=grader-public-key
export REFRESH_TOKEN_PEPPER=grader-pepper

npm ci
```

Verify compilation, linting and architecture:

```bash
npm run typecheck
npm run lint
npm run architecture
```

Expected: all commands exit `0`.

Verify all four bidirectional quality gates:

```bash
npm run demo:gates
```

Expected:

```text
types-style-ok=0
types-style-broken!=0
contract-ok=0
contract-broken!=0
architecture-ok=0
architecture-broken!=0
image-scan-ok=0
image-scan-broken!=0
```

Verify OIDC locally without GitHub:

```bash
npm run demo:oidc
```

Expected:

```text
case=green
sig-verified=1
policy-allow=1
case=foreign-sub
sig-verified=1
policy-allow=0
case=bad-signature
sig-verified=0
policy-allow=0
```

Verify cost rejection:

```bash
PLAN_JSON=fixtures/hw32/cost/plan.json \
COST_BUDGET_USD=0 \
npm run gate:cost
```

Expected: non-zero exit and:

```text
gate=fail
```

Verify cost acceptance:

```bash
PLAN_JSON=fixtures/hw32/cost/plan.json \
COST_BUDGET_USD=999999 \
npm run gate:cost
```

Expected:

```text
gate=pass
```

Verify that every external GitHub Action is pinned to a full 40-character commit SHA:

```bash
grep -rhoE '^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*[^[:space:]#]+' \
  .github/workflows \
  | sed -E 's/.*uses:[[:space:]]*//' \
  | awk '
    $0 !~ /^\.\// && $0 !~ /@[0-9a-f]{40}$/ {
      print
    }
  '
```

Expected: no output.

Verify that there is only one container image build invocation:

```bash
grep -RniE \
  'docker[[:space:]]+build|docker/build-push-action|npm run image:build' \
  .github/workflows
```

Expected: exactly one result, the build step in `.github/workflows/pr.yml`.

Verify OIDC permissions:

```bash
grep -rn 'id-token: write' .github/workflows
```

Expected: only job-level permissions in the HW32 PR and deployment workflows.

Validate GitHub Actions syntax:

```bash
docker run --rm \
  -v "$(pwd):/repo" \
  --workdir /repo \
  rhysd/actionlint:1.7.12 \
  -color
```

Expected: exit `0` with no diagnostics.
