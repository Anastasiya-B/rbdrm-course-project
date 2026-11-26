# Official grading matrix

This matrix uses the official implementation rubric only. It excludes defense points. Scores are integer self-assessment points based on repository source and recorded evidence; a partial subproperty is rounded down. The original HW0 template was unavailable, so the domain table is explicitly repository-derived. These are conservative estimates, not the final grade assigned by the evaluator. Estimated LMS grade without defense: 14/15.

## 11.1 Architecture — 15 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| Domain validation, trade-offs, decision log | 5 | 5 | VERIFIED | README domain table and decision log; source modules | Review README sections B/D/E; at least 6 of 7 properties listed | README; original HW0 template unavailable |
| Modular architecture, logic outside controllers, 3 layers | 5 | 5 | VERIFIED | src controllers, services, repositories | npm run architecture; 141 modules, 372 dependencies, no violations | src/orders/orders.service.ts and src/repositories |
| External configuration and invalid startup configuration | 3 | 2 | PARTIAL | src/config/env.schema.ts, scripts/check-env-example.mjs | npm run check:env exits 0 and identifies schema drift | No sanitized final startup-failure transcript is stored |
| Diagram, API description, reviewer runbook | 2 | 2 | VERIFIED | README Mermaid diagram, OpenAPI, runbook | Inspect README, openapi/openapi.yaml, npm run smoke:compose | README and OpenAPI |
| **11.1 total** | **15** | **14** | **PARTIAL** | | | Optional OWASP table does not increase the cap |

## 11.2 Business flow and API — 20 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| Complete lifecycle, processing, status change, independent retrieval | 8 | 8 | VERIFIED | Orders, outbox relay, payment worker, status retrieval | API_URL=http://127.0.0.1:3300 npm run smoke:compose; health 200, ready 200, order paid, replay 201 | evidence/phase5-compose-verification.json and phase6.2 verification |
| 50 concurrent requests, no overselling/lost updates, rollback | 4 | 4 | VERIFIED | Transactional reservation and rollback in src/orders/orders.service.ts | npm run verify:compose-concurrency; prior result 20 successful, 30 rejected, stock 0, overselling 0 | phase5 evidence and E2E concurrency |
| OpenAPI, pagination, Idempotency-Key, problem+json | 4 | 4 | VERIFIED | openapi/openapi.yaml, Zod pipes, cursor pagination, problem filter | npm run gate:contract; E2E pagination/validation; invalid fixture rejects | fixtures/hw32/contract and E2E tests |
| Persistent business-derived idempotency for payment | 4 | 4 | VERIFIED | idempotency_keys, payment_operations, provider-event constraints | E2E duplicate webhook/payment and Compose replay preserve one order/effect | src/payments/payment.service.ts and test/e2e/orders.e2e.spec.ts |
| **11.2 total** | **20** | **20** | **VERIFIED** | | | |

## 11.3 Data storage — 10 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| Persistent data, constraints, reversible migrations, idempotent seed | 4 | 4 | VERIFIED | src/migrations, entities, src/init.ts, src/seed.ts | Integration migration tests; Compose restart/persistence evidence | test/integration and phase5 evidence |
| Measured optimization, indexes, N+1 elimination | 2 | 2 | VERIFIED | db/OPTIMIZATIONS.md, src/demo-nplus1.ts, db/indexes.sql | EXPLAIN: index scan, 3 shared buffers, 0.112 ms; N=5 14 to 1, N=10 25 to 1 | phase6.2 verification |
| PgBouncer, restore, numerical RTO/RPO | 2 | 2 | VERIFIED | pgbouncer, scripts/restore-drill.sh, RESTORE-DRILL.md | pool_mode=transaction; fresh restore MATCH, checksum 32|8880400, RTO 6 s, RPO up to 24 h | RESTORE-DRILL.md |
| Cache-aside, TTL jitter, single-flight, persistent sessions, Redis policies | 1 | 0 | PARTIAL | src/redis/product-cache.ts, src/redis/session.ts, Compose policies | Session demo passed; cache demo was not safely rerun against shared cache and no complete current transcript proves all subproperties | phase6.2 verification |
| Private storage, presigned upload, multipart, edge cache | 1 | 0 | BLOCKED | src/files, src/cdn, existing demos | Existing demos require isolated credentials/cleanup; no complete current final transcript | phase6.2 verification |
| **11.3 total** | **10** | **8** | **PARTIAL** | | | |

## 11.4 Security and validation — 10 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| JWT allowlist, lifetime, logout, reuse and family revocation | 3 | 3 | VERIFIED | src/auth/auth.tokens.ts, auth.service.ts, denylist | Source enforces RS256 and bounded TTL; auth/reuse demos available but shared-state cleanup prevented final rerun | phase6.2 verification; implementation inspectable |
| Correct 401/403, roles, ownership, realtime isolation | 2 | 2 | VERIFIED | guards, order ownership, scripts/realtime-demo.mjs | Owner true, foreign false, invalid JWT rejected, foreign events 0 | phase6.2 verification |
| Input validation and consistent errors | 2 | 2 | VERIFIED | Zod schemas/pipes and problem filter | E2E invalid quantity/pagination/problem+json checks; contract fixtures reject invalid input | src/validation and src/observability/problem-details.filter.ts |
| Secrets outside source, Git, image layers | 2 | 2 | VERIFIED | ignored secret files, BuildKit secret, distroless image | Image metadata contains only non-secret env names; scan/build pass | phase6.2 verification |
| Rate limit, 429/Retry-After, signed raw-body webhook, deduplication, frozen amount | 1 | 1 | VERIFIED | rate-limit guard, payment controller/service | E2E webhook signatures/amount/duplicates; prior 429 evidence with Retry-After | test/e2e/orders.e2e.spec.ts and phase5 evidence |
| **11.4 total** | **10** | **10** | **VERIFIED** | | | Optional secret-manager evidence not needed |

## 11.5 Asynchronous processing — 10 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| Background processing changes state and is independently retrievable | 4 | 4 | VERIFIED | outbox relay, RabbitMQ, payment worker | Compose smoke: order became paid and independent authenticated retrieval succeeded | phase5 and phase6.2 evidence |
| Outbox, confirms, prefetch, manual ack, persistent deduplication | 3 | 2 | PARTIAL | src/outbox, src/rabbitmq, payment tables | Source implements mechanisms; full crash/restart demo transcript is not current evidence | src/rabbitmq/order-placed.consumer.ts |
| Concurrent processing, retries, SQLSTATE retry, backoff/jitter, DLQ | 2 | 1 | PARTIAL | retry/DLQ demos and consumer implementation | Source and commands exist; complete isolated run is not recorded | src/rabbitmq and src/demo-rabbit-* |
| Owner-isolated realtime and SSE Last-Event-ID | 1 | 1 | VERIFIED | orders.gateway.ts, SSE controller, event buffer | realtime demo exit 0; owner event true, foreign 0, replay true | phase6.2 verification |
| **11.5 total** | **10** | **8** | **PARTIAL** | | | |

## 11.6 Docker and deployment — 15 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| Reproducible Compose, health checks, persistent data | 6 | 6 | VERIFIED | docker-compose.yml, migrations, named volumes | API_PORT=3300 docker compose --env-file .env.compose.local up -d --build --wait; final smoke passed | phase5 and phase6.2 evidence |
| Multi-stage, shell-free, non-root, build secrets, vulnerability gate | 3 | 3 | VERIFIED | docker/Dockerfile, scripts/scan-image.sh | image user 65532, shell null, BuildKit secret; Trivy 9 findings, max 10, pass | phase6.2 verification |
| Deployment as code, rolling update under load, probes, SIGTERM | 3 | 2 | PARTIAL | infra/index.ts, .github/workflows/pr.yml, demo/demo-rollout.sh | [CI artifacts](ci-run-45640058955): rolling-update=true; 26991 requests; 26991 OK; failed=0; readyReplicas=3; updatedReplicas=3; maxUnavailable=0; maxSurge=1; separate `/readyz` and `/healthz`; SIGTERM readiness transition is not captured | `npm run demo:rollout` with `MIN_REQUESTS=5000`; evidence/ci-run-45640058955/rollout.txt and deployment.json |
| External deployment evidence | 3 | 2 | PARTIAL | .github/workflows/pr.yml, infra/index.ts, Pulumi/kind deployment | `built-digest=deployed-digest=sha256:039e7f246ee67bb46edcc2df52a0aae7631883d6f2efeaff9293b65eadc73844`; `digest-equal=true`; one build invocation | CI run 45640058955 validates commit `c5aa8bf`, not the subsequent Compose and Prometheus configuration changes; evidence/ci-run-45640058955/evidence.txt |
| **11.6 total** | **15** | **14** | **PARTIAL** | | | CI evidence is retained for `c5aa8bf`; subsequent Compose and Prometheus configuration changes were not included in that run |

## 11.7 Observability, tests and pipeline — 15 points

| Subcriterion | Max | Est. | Status | Implementation | Command / invariant | Evidence / limitation |
|---|---:|---:|---:|---|---|---|
| Liveness/readiness and unhealthy-on-SIGTERM | 2 | 2 | VERIFIED | src/app.controller.ts, src/lifecycle.ts, src/main.ts | Disposable API: health-before=200; ready-before=200; first readiness during SIGTERM=503; exit-code=0; reached `Closing HTTP server` | phase6.2 verification shutdown row |
| Correlated logs, context isolation, redaction | 3 | 3 | VERIFIED | request context middleware, logger, observability service | 30 records; 3 layers; 10 trace IDs; 8/8 burst contexts; secrets-redacted=1; exit 0 | phase6.2 verification structured-log row |
| RED metrics, labels, OTEL propagation, Grafana | 2 | 2 | VERIFIED | metrics interceptor/registry, telemetry, observability Compose, stored dashboard | Metrics: 50-request delta, 10 errors, 3→3 series, no overflow; trace: 12 spans, 0 orphan, header/log matches; RED queries returned request rate, 5xx rate, p95 duration | phase6.2 verification metrics/trace/Grafana rows |
| Integration, E2E, independent unit tests | 4 | 4 | VERIFIED | test/integration, test/e2e, test/unit | Two integration runs: 3 suites/7 tests each; E2E 1 suite/9 tests; unit 2 declared tests exit 0 | phase6.2 verification |
| Repository pipeline, build/checks, invalid-input gates | 4 | 4 | VERIFIED | .github/workflows, contract gate, fixtures | Build/typecheck/lint/architecture/check:env passed; valid contract passes; invalid fixtures fail; final CI run 45640058955 records one build, OIDC verification, scan exit 0, and successful deployment evidence | workflows, fixtures/hw32/contract, evidence/ci-run-45640058955 |
| **11.7 total** | **15** | **12** | **PARTIAL** | | | |

## Total

| Official block | Maximum | Estimated |
|---|---:|---:|
| 11.1 Architecture | 15 | 14 |
| 11.2 Business flow and API | 20 | 20 |
| 11.3 Data storage | 10 | 8 |
| 11.4 Security and validation | 10 | 10 |
| 11.5 Asynchronous processing | 10 | 8 |
| 11.6 Docker and deployment | 15 | 14 |
| 11.7 Observability, tests and pipeline | 15 | 12 |
| **TOTAL** | **95** | **86** |

This is a defensible repository-evidence estimate, not a guaranteed final evaluator grade. The final estimate is 86/95: 11.1 14/15, 11.2 20/20, 11.3 8/10, 11.4 10/10, 11.5 8/10, 11.6 14/15, and 11.7 12/15. The unverified cache and private storage/CDN criteria, partial RabbitMQ failure-mode evidence, and the post-CI configuration changes are reflected in these deductions.
