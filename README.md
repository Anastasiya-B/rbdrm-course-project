# HW28 — Zero-Downtime Kubernetes Deployment

NestJS application deployed to a local `kind` cluster with Pulumi, rolling updates, readiness/liveness probes, PDB, HPA, runtime secrets, distroless Docker image and vulnerability scanning.

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

## Grading

Run from a fresh clone.

Create local untracked secret files and Pulumi state directory:

```bash
mkdir -p secrets
mkdir -p .pulumi

printf '%s' 'hw28-grading-password' > secrets/db_password
printf '%s' 'hw28-build-bait-token' > .npm_token
```

`secrets/`, `.npm_token` and `.pulumi/` are ignored by Git.

Export grading environment:

```bash
export SKIP_VAULT=1
export APP_DB_PASSWORD="$(cat secrets/db_password)"
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PULUMI_CONFIG_PASSPHRASE="hw28-grading"

export JWT_KID="grader"

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

Install:

```bash
npm ci
npm --prefix infra ci
```

Build and verify image:

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

Final checks:

```bash
npx tsc --noEmit
npm --prefix infra run typecheck
git diff --check
```

Cleanup:

```bash
npm run destroy
npm run cluster:down
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
demo/
  demo-image.sh
  demo-rollout.sh
  demo-pdb.sh
  rollout-load.mjs
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
hw-28
```

Submit a Pull Request from `hw-28`.
