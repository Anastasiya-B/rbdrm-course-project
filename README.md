# HW28–HW29 — Zero-Downtime Kubernetes Deployment & Observability

NestJS application deployed to a local `kind` cluster with Pulumi, rolling updates, readiness/liveness probes, PDB, HPA, runtime secrets, distroless Docker image, vulnerability scanning, structured logging, RED metrics, OpenTelemetry tracing and a provisioned Grafana dashboard.

## Requirements

- Docker
- Node.js 22+
- `kubectl`
- `kind`
- Pulumi CLI or `npx pulumi`

Install dependencies:

```bash
npm ci
npm --prefix infra ci
```

## Environment

Commands requiring secrets use `scripts/with-secrets.sh`.

For grading without Infisical:

```bash
export SKIP_VAULT=1
export APP_DB_PASSWORD="$(cat secrets/db_password)"
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PULUMI_CONFIG_PASSPHRASE="hw28-grading"
```

Required runtime secrets:

| Variable               | Source  |
| ---------------------- | ------- |
| `APP_DB_PASSWORD`      | сховище |
| `JWT_KID`              | сховище |
| `JWT_PRIVATE_KEY`      | сховище |
| `JWT_PUBLIC_KEY`       | сховище |
| `REFRESH_TOKEN_PEPPER` | сховище |

Example local auth values:

```bash
export JWT_KID="hw28-local-key"

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:2048 \
  -out /tmp/hw28-private.pem

openssl rsa \
  -pubout \
  -in /tmp/hw28-private.pem \
  -out /tmp/hw28-public.pem

export JWT_PRIVATE_KEY="$(openssl base64 -A -in /tmp/hw28-private.pem)"
export JWT_PUBLIC_KEY="$(openssl base64 -A -in /tmp/hw28-public.pem)"
export REFRESH_TOKEN_PEPPER="$(openssl rand -hex 32)"
```

No new tracked `.env` file is required.

## Production image

Build:

```bash
npm run image:build
```

The Dockerfile uses multiple stages and a distroless non-root runtime.

BuildKit receives `.npm_token` only through a secret mount. `.npm_token` is ignored by Git.

Verify:

```bash
npm run demo:image
```

Expected:

```text
stages=3
shell-inside=0
runtime-uid=65532
token-in-history=0
token-in-config=0
token-in-layers=0
```

`demo:image` checks the token in image history, image config and unpacked layer contents. Compressed gzip layers are decompressed before the token search.

## Vulnerability scan

```bash
npm run scan
```

Current measured result:

```text
image=rbdrm-marketplace:hw28
severity=HIGH,CRITICAL
found=9
max-allowed=10
gate=pass
```

Gate checks:

```bash
SCAN_MAX=-1 npm run scan
```

Expected: non-zero exit code and `gate=fail`.

```bash
SCAN_MAX=99999 npm run scan
```

Expected: exit code `0` and `gate=pass`.

CI workflow:

```text
.github/workflows/hw28-security.yml
```

It builds the image, verifies the image contract and runs the vulnerability scan.

## Kubernetes

Local cluster:

```bash
npm run cluster:up
```

The image is loaded into `kind` after build.

Local platform:

```text
Docker Desktop + kind on macOS
```

Check Docker/kind memory:

```bash
docker info --format '{{.MemTotal}}' \
  | awk '{printf "%.2f GiB\n", $1/1024/1024/1024}'
```

Docker/kind available memory on the development machine:

```text
7.65 GiB
```

Deploy with Pulumi:

```bash
npm run up
```

Pulumi creates:

- Namespace
- Secret
- Deployment
- Service
- PodDisruptionBudget
- HorizontalPodAutoscaler

Main configuration:

```text
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
```

### Deployment replicas and HPA ownership

The Deployment starts with `replicas=3` so a fresh installation immediately satisfies the availability requirements.

After deployment, HPA owns runtime scaling between `2` and `5` replicas.

`spec.replicas` therefore has two potential owners: Pulumi and the HPA controller. Pulumi ignores subsequent changes to `spec.replicas` after initial creation so it does not fight HPA scaling decisions.

Check:

```bash
kubectl -n marketplace-hw28 get pods
kubectl -n marketplace-hw28 get deploy marketplace-deployment
kubectl -n marketplace-hw28 get svc marketplace-service
kubectl -n marketplace-hw28 get pdb marketplace-pdb
kubectl -n marketplace-hw28 get hpa marketplace-hpa
```

On local `kind` without Metrics Server, HPA CPU may show:

```text
cpu: <unknown>/70%
```

This is expected.

Health endpoints:

```bash
curl http://127.0.0.1:30080/healthz
curl http://127.0.0.1:30080/readyz
```

Expected:

```json
{ "status": "alive" }
```

```json
{ "status": "ready" }
```

## Graceful shutdown

On `SIGTERM` the application:

```text
mark not ready
→ wait 5 seconds for draining
→ close HTTP server
→ exit
```

Kubernetes termination grace period is `15s`, which is longer than the `5s` drain period.

## Zero-downtime rollout

Run:

```bash
npm run demo:rollout
```

The demo performs a real Pulumi revision change while HTTP traffic is running.

Each HTTP response code is written to a temporary evidence file, one code per line. `requests`, `ok` and `failed` are calculated from that file rather than only from in-memory counters.

Example evidence:

```text
200
200
200
200
```

Transport errors are recorded as:

```text
0
```

Measured result:

```text
profile=correct
requests=50809
ok=50809
failed=0
rollout-seconds=61
```

Acceptance requirement:

```text
requests >= 5000
failed=0
```

## PodDisruptionBudget

Run:

```bash
npm run demo:pdb
```

Expected measured output:

```text
healthy=3
minAvailable=2
evict-1=201
evict-2=429
```

The first request uses the Kubernetes Eviction API successfully. The second is rejected by the PDB because evicting another pod would violate `minAvailable=2`.

## Runtime secrets

Pulumi creates a Kubernetes `Secret`.

Sensitive values are referenced from the Deployment through `secretKeyRef`.

`APP_DB_PASSWORD` is also mounted as:

```text
/run/secrets/db_password
```

for the existing `DB_PASSWORD_FILE` configuration.

Secret values are not placed directly in the Deployment environment specification.

In production, an External Secrets Operator or Secrets Store CSI Driver would normally synchronize secrets from an external secret manager.

## Pulumi backend

Local file backend:

```bash
mkdir -p .pulumi
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PULUMI_CONFIG_PASSPHRASE="hw28-grading"
```

Pulumi commands:

```bash
npm run up
npm run destroy
```

## Observability

HW29 adds structured JSON logging, RED metrics, OpenTelemetry tracing and a provisioned Grafana dashboard.

### Runtime variables

| Variable                      | Purpose                       | Source                                           |
| ----------------------------- | ----------------------------- | ------------------------------------------------ |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP endpoint for traces | `scripts/with-secrets.sh` / exported environment |
| `PROMETHEUS_URL`              | Prometheus API endpoint       | `scripts/with-secrets.sh` / exported environment |
| `TRACE_API_URL`               | Tempo trace API endpoint      | `scripts/with-secrets.sh` / exported environment |
| `GRAFANA_USER`                | Grafana username              | `scripts/with-secrets.sh` / exported environment |
| `GRAFANA_PASSWORD`            | Grafana password              | `scripts/with-secrets.sh` / exported environment |

No additional HW29 `.env` file is required.

### Structured logs

Application request logs are emitted as JSON using Pino.

The correlation identifier is the active OpenTelemetry `trace_id`, not a separately generated UUID.

Request-scoped values such as `userId`, `tenant` and `idempotencyKey` are stored in `AsyncLocalStorage`.

The observability request crosses at least three logged layers:

- `orders.controller`
- `orders.service`
- `orders.repo`

The same `trace_id` is preserved across all three layers.

Authorization tokens and passwords are redacted before log output.

Latest verified `demo:logs` result:

```text
non-json-lines=0
layers=3
distinct-trace-ids=1
trace-id-matches-header=1
burst=8
burst-trace-ids=8
burst-uneven=0
secret-req-logged=1
secret-in-logs=0
```

The demo was run three times consecutively with the same result.

### RED metrics

Metrics are exposed at:

```text
/metrics
```

The `route` label uses the route template, for example:

```text
/observability/orders/:id
```

rather than a raw URL containing a concrete id.

#### Rate

Question: how much traffic is the service receiving?

```promql
sum(rate(http_requests_total[1m]))
```

#### Errors

Question: how many HTTP 5xx responses are occurring?

```promql
sum(rate(http_requests_total{status=~"5.."}[1m]))
```

#### Duration

Question: how long are requests taking?

```promql
histogram_quantile(
  0.95,
  sum by (le) (
    rate(http_request_duration_seconds_bucket[1m])
  )
)
```

Histogram bucket boundaries:

```text
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
```

The largest finite bucket is `10` seconds.

`demo:metrics` verifies bucket coverage by calculating:

```text
_count - _bucket{le="10"}
```

and requires:

```text
above-top-bucket=0
```

Latest verified result:

```text
sent-ok=40
sent-fail=10
counter-delta=50
errors-delta=10
above-top-bucket=0
series-before=3
series-after=3
```

The demo was run three times consecutively with the same result.

### OpenTelemetry tracing

Incoming W3C `traceparent` headers are continued by OpenTelemetry.

The trace demo compares the same request across:

1. the trace id supplied in `traceparent`;
2. `trace_id` in the structured application log;
3. the trace id exported to the trace backend.

The demo also verifies that:

- the trace contains at least two spans;
- child spans are connected;
- an HTTP 500 request produces a span with ERROR status.

Latest verified `demo:trace` result:

```text
spans=11
orphan-spans=0
trace-matches-header=1
trace-matches-log=1
span-status-error=1
```

### Local observability stack

| Component       | Address                  |
| --------------- | ------------------------ |
| Grafana         | `http://127.0.0.1:22900` |
| Prometheus      | `http://127.0.0.1:22901` |
| Tempo trace API | `http://127.0.0.1:22904` |
| OTLP HTTP       | `http://127.0.0.1:22918` |

The Grafana datasource and dashboard are provisioned from repository files.

Dashboard:

```text
observability/grafana/dashboards/marketplace-observability.json
```

The dashboard contains three RED panels:

- request rate;
- HTTP 5xx error rate;
- p95 request duration.

## Grading

Run from a fresh clone.

### 1. Prepare local untracked files

```bash
mkdir -p secrets
mkdir -p .pulumi

printf '%s' 'hw28-grading-password' > secrets/db_password
printf '%s' 'hw28-build-bait-token' > .npm_token
```

`secrets/`, `.npm_token` and `.pulumi/` are ignored by Git.

### 2. Export grading environment

```bash
export SKIP_VAULT=1
export APP_DB_PASSWORD="$(cat secrets/db_password)"
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PULUMI_CONFIG_PASSPHRASE="hw28-grading"

export JWT_KID="grader"

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:2048 \
  -out /tmp/hw29-private.pem

openssl rsa \
  -pubout \
  -in /tmp/hw29-private.pem \
  -out /tmp/hw29-public.pem

export JWT_PRIVATE_KEY="$(openssl base64 -A -in /tmp/hw29-private.pem)"
export JWT_PUBLIC_KEY="$(openssl base64 -A -in /tmp/hw29-public.pem)"
export REFRESH_TOKEN_PEPPER="$(openssl rand -hex 32)"

export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:22918
export PROMETHEUS_URL=http://127.0.0.1:22901
export TRACE_API_URL=http://127.0.0.1:22904
```

If the local database is started from the repository Docker Compose stack, use:

```bash
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_USER=marketplace
export DB_PASSWORD=marketplace_password
export DB_NAME=marketplace
export DB_URL="postgresql://marketplace:marketplace_password@127.0.0.1:5432/marketplace"
```

### 3. Install dependencies

```bash
npm ci
npm --prefix infra ci
```

### 4. HW28 image and security checks

```bash
npm run image:build
npm run demo:image
```

Check scan gate:

```bash
set +e
SCAN_MAX=-1 npm run scan
NEGATIVE_SCAN_EXIT=$?
set -e

test "$NEGATIVE_SCAN_EXIT" -ne 0

SCAN_MAX=99999 npm run scan
```

### 5. Start application dependencies

```bash
docker compose up -d --wait
```

### 6. Start observability stack

```bash
docker compose \
  -f observability/docker-compose.yml \
  up -d --wait
```

The observability stack uses ports in the `22900–22999` range.

Verify:

```bash
curl -s http://127.0.0.1:22901/-/ready
curl -s http://127.0.0.1:22900/api/health
```

### 7. Compile

```bash
npx tsc --noEmit
npm run build
```

### 8. Run HW29 acceptance demos

```bash
npm run demo:logs
npm run demo:metrics
npm run demo:trace
```

Expected `demo:logs` invariants:

```text
non-json-lines=0
layers>=3
distinct-trace-ids=1
trace-id-matches-header=1
burst>=8
burst-trace-ids=burst
burst-uneven=0
secret-req-logged=1
secret-in-logs=0
```

Expected `demo:metrics` invariants:

```text
sent-ok + sent-fail >= 50
counter-delta = sent-ok + sent-fail
errors-delta = sent-fail
above-top-bucket=0
series-after = series-before
```

Expected `demo:trace` invariants:

```text
spans>=2
orphan-spans=0
trace-matches-header=1
trace-matches-log=1
span-status-error=1
```

The three demo scripts are invoked through `scripts/with-secrets.sh`.

### 9. HW28 Kubernetes acceptance

Create cluster and deploy:

```bash
npm run cluster:up
npm run up
```

Verify resources:

```bash
kubectl -n marketplace-hw28 get pods
kubectl -n marketplace-hw28 get deploy marketplace-deployment
kubectl -n marketplace-hw28 get svc marketplace-service
kubectl -n marketplace-hw28 get pdb marketplace-pdb
kubectl -n marketplace-hw28 get hpa marketplace-hpa
```

Run acceptance demos:

```bash
npm run demo:rollout
npm run demo:pdb
```

### 10. Final checks

```bash
npx tsc --noEmit
npm --prefix infra run typecheck
git diff --check
```

Check that the HW29 demo scripts use the secret wrapper:

```bash
node -e "
const s=require('./package.json').scripts;
const need=['demo:logs','demo:metrics','demo:trace'];
const bad=need.filter(k=>/with-secrets\\.sh/.test(s[k]||'')===false);
console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));
process.exit(bad.length===0?0:1);
"
```

Expected:

```text
OK
```

### 11. Cleanup

```bash
docker compose \
  -f observability/docker-compose.yml \
  down

npm run destroy
npm run cluster:down
docker compose down
```

## Structure

```text
docker/
  Dockerfile

infra/
  index.ts
  package.json
  package-lock.json
  Pulumi.yaml
  tsconfig.json

k8s/
  kind-config.yaml

observability/
  docker-compose.yml
  prometheus/
    prometheus.yml
  grafana/
    dashboards/
      marketplace-observability.json
    provisioning/
      dashboards/
        marketplace.yml
      datasources/
        marketplace.yml

demo/
  demo-image.sh
  demo-rollout.sh
  demo-pdb.sh
  rollout-load.mjs
  demo-logs.sh
  demo-logs.mjs
  demo-metrics.sh
  demo-metrics.mjs
  demo-trace.sh
  demo-trace.mjs

src/
  observability/
    context.ts
    logger.ts
    metrics.ts
    metrics.controller.ts
    metrics.interceptor.ts
    observability.controller.ts
    observability.service.ts
    orders.repository.ts
    request-context.middleware.ts
    telemetry.ts

scripts/
  cluster-up.sh
  cluster-down.sh
  pulumi-up.sh
  pulumi-destroy.sh
  scan-image.sh
  with-secrets.sh

.github/workflows/
  hw28-security.yml
```

## Submission

Branch:

```text
hw-29
```

Submit a Pull Request from `hw-29`.

The `OpenTelemetry tracing` section contains the latest verified passing `demo:trace` numbers.
