# Final verification evidence

Captured from the course-project repository. Secret values, tokens, and personal Docker socket paths are omitted.

| Area | Exact command | Result | Status |
|---|---|---|---|
| Build | npm run build | exit 0 | VERIFIED |
| Typecheck | npm run typecheck | exit 0 | VERIFIED |
| Lint | npm run lint | exit 0 | VERIFIED |
| Architecture | npm run architecture | exit 0; 141 modules, 372 dependencies, no violations | VERIFIED |
| Environment schema | npm run check:env | exit 0; .env.example synchronized | VERIFIED |
| Unit tests | npm run test:unit | exit 0; 2 independent test declarations | VERIFIED |
| Integration run 1 | npm run test:integration | 3 suites, 7 tests passed | VERIFIED |
| Integration run 2 | npm run test:integration | 3 suites, 7 tests passed | VERIFIED |
| E2E | npm run test:e2e | 1 suite, 9 tests passed; includes concurrency | VERIFIED; Jest left open handles after summary |
| Pact consumer | npm run test:contract | exit 0; 1 test declaration | VERIFIED |
| Pact provider | npm run verify:provider | exit 0; 1 test declaration | VERIFIED |
| Positive contract gate | npm run gate:contract | valid fixture accepted | VERIFIED |
| Negative contract gate | OPENAPI_CANDIDATE=fixtures/hw32/contract/invalid.yaml npm run gate:contract | invalid/breaking fixture rejected as expected | VERIFIED |
| Main baseline security exception | bash scripts/hw32/contract-gate.sh .hw32/openapi-base.yaml openapi/openapi.yaml | exit 0; the three intentional order-operation security changes were ignored by exact method/path/description rules | VERIFIED |
| Existing breaking fixture | bash scripts/hw32/contract-gate.sh fixtures/hw32/contract/base.yaml fixtures/hw32/contract/broken.yaml | exit 1; api-path-removed-without-deprecation remained fatal | VERIFIED |
| Unrelated anonymous-access removal | bash scripts/hw32/contract-gate.sh fixtures/hw32/contract/base.yaml fixtures/hw32/contract/unrelated-anonymous-access-removal.yaml | exit 1; GET /products api-security-anonymous-access-removed remained fatal | VERIFIED |
| Diff hygiene | git diff --check | exit 0 | VERIFIED |
| Database plan | EXPLAIN (ANALYZE, BUFFERS) product query | index scan; 3 shared buffers; 0.112 ms | VERIFIED |
| N+1 | docker network demo:nplus1 | N=5 14 to 1; N=10 25 to 1; optimized count 1 | VERIFIED |
| PgBouncer | SHOW POOLS and SHOW CONFIG | pool_mode=transaction | VERIFIED |
| Restore | DATABASE_URL=local bash scripts/restore-drill.sh | fresh backup; source/restored 32|8880400; 48K; RTO 6 s; MATCH; exit 0 | VERIFIED |
| Session | npm run demo:session | requests=3, sessions=1, in-redis=1, ttl-renewed=1 | VERIFIED |
| Cache | npm run demo:cache | not rerun against shared cache because demo flushes cache DB; shell attempt lacked Compose variables | PARTIAL |
| Storage/CDN | npm run demo:upload; demo:multipart; demo:cdn | cleanup-heavy demos require isolated credentials/resources; no complete final transcript | BLOCKED |
| Auth/RBAC | npm run demo:auth; demo:reuse; demo:rbac | cleanup-heavy demos require isolated database; source and E2E authorization remain available | PARTIAL |
| Realtime | BASE_URL=http://127.0.0.1:3300 npm run demo:realtime | paid; ownerJoin=true; foreignJoinRejected=true; invalidJwtRejected=true; ownerReceived=true; foreignReceived=0; sseReplayObserved=true; exit 0 | VERIFIED |
| Compose smoke | API_URL=http://127.0.0.1:3300 npm run smoke:compose | health 200; ready 200; order paid; independent retrieval; replay 201 | VERIFIED |
| Image build | npm run image:build | exit 0; final multi-stage image built | VERIFIED |
| Image metadata | docker image inspect rbdrm-marketplace:hw28 | UID 65532; shell null; node entrypoint; no secret env names | VERIFIED |
| Vulnerability gate | npm run scan | found=9; severity HIGH,CRITICAL; max-allowed=10; gate=pass | VERIFIED |
| Deployment evidence | inspect evidence/base*, evidence/demos.txt, workflows | previous AWS evidence is not a six-zero teardown; final kind deployment is verified by run 45640058955 | VERIFIED via accepted CI deployment evidence |
| Final CI/CD deployment | [GitHub Actions run 45640058955](https://github.com/Anastasiya-B/rbdrm-course-project/actions/runs/45640058955) and [local artifacts](ci-run-45640058955) | built/deployed digest equal; build-invocations=1; rolling-update=true; requests=26991; ok=26991; failed=0; rollout-seconds=43; readyReplicas=3; updatedReplicas=3; maxUnavailable=0; maxSurge=1; OIDC signature=1; secret-in-manifest=0; scan exit=0 | VERIFIED |
| Shutdown readiness | `curl /healthz`; `curl /readyz`; SIGTERM; repeated `curl /readyz` | No isolated API process was available; no shutdown HTTP status or process exit result recorded | BLOCKED |
| Structured logs | `npm run demo:logs` | wrapper could not start a standalone API with the isolated database URL; terminated without shared-container changes; no numerical result | BLOCKED |
| RED metrics | `API_URL=http://127.0.0.1:30080 node demo/demo-metrics.mjs` | exit 1; warm-up returned `ok=404 not-found=404 fail=404`; running kind image has `/metrics` returning 404 | BLOCKED |
| OpenTelemetry trace | `npm run demo:trace` | not executed after API prerequisite failure; OTLP backend `/ready` returned `ready`; no trace delivery result | BLOCKED |
| Grafana RED dashboard source | inspect `observability/grafana/dashboards/marketplace-observability.json` | stored dashboard contains Request rate, 5xx error rate, and Request duration p95 panels | VERIFIED |
| Compose endpoint verification | `curl http://127.0.0.1:3300/{healthz,readyz,metrics}` | healthz=200; readyz=200; metrics=200; running image `marketplace-course-api` | VERIFIED |
| Graceful shutdown | disposable `docker compose --env-file .env.compose.local run ... api`; SIGTERM; repeated `curl http://127.0.0.1:3310/readyz` | health-before=200; ready-before=200; first readiness during shutdown=503; exit-code=0; shutdown log reached `Closing HTTP server` | VERIFIED |
| Structured logs | `API_URL=http://127.0.0.1:3300 node demo/demo-logs.mjs` plus live `docker logs` capture | request-log-lines=30; normal-layers=3; distinct-trace-ids=10; burst=8; burst-trace-ids=8; secret-request-logs=3; secrets-redacted=1; exit 0 | VERIFIED |
| RED metrics/cardinality | `API_URL=http://127.0.0.1:3300 node demo/demo-metrics.mjs` | sent-ok=40; sent-fail=10; counter-delta=50; errors-delta=10; above-top-bucket=0; series-before=3; series-after=3; exit 0 | VERIFIED |
| OpenTelemetry trace | `API_URL=http://127.0.0.1:3300 TRACE_API_URL=http://127.0.0.1:22904 TRACE_LOG_FILE=... node demo/demo-trace.mjs` | spans=12; orphan-spans=0; trace-matches-header=1; trace-matches-log=1; span-status-error=1; exit 0 | VERIFIED |
| Grafana RED dashboard data | Prometheus queries matching stored dashboard | target health=up; request rate=3.2575734658355664 req/s; 5xx rate=0.21884631517516823 req/s; duration p95=0.26125432475098304 s | VERIFIED |

## Runtime and troubleshooting notes

Docker Desktop/Testcontainers is required for integration/E2E infrastructure. The local environment previously required removing CODEX_CI for test commands; workflows use env -u CODEX_CI. If Docker uses a different local socket, configure Docker Desktop or set a shell-local DOCKER_HOST; no personal absolute socket is part of the repository.

No development database or persistent volume was reset. Restore used a dedicated temporary restore container and volume. Cleanup-heavy demos were not forced against shared state.

The final CI artifacts record the post-change gates. `rollout-http-codes.txt` contains exactly 26,991 lines, all `200`. `rollout.txt` records a Pulumi update from the previous revision to `hw28-1795618996`, followed by `requests=26991`, `ok=26991`, `failed=0`, and `rollout-seconds=43`. `deployment.json` records 3 replicas, 3 ready replicas, 3 updated replicas, separate `/readyz` and `/healthz` probes, `maxUnavailable=0`, `maxSurge=1`, and a 15-second termination grace period. `evidence.txt` records equal built/deployed digests, one build invocation, OIDC signature verification, zero secret values in the manifest, and scan exit 0. Rollout traffic targeted the Kubernetes Service health endpoint, as shown in `rollout.txt`.

The artifact secret review found only environment-variable names, Kubernetes Secret references, and Pulumi's literal `[secret]` redaction marker. No private key, password, token, or secret value is present in the retained files.

The final runtime verification used the current Compose API at port 3300, not the stale kind API. A confirmed Prometheus configuration defect was corrected from `host.docker.internal:3000` to `host.docker.internal:3300`; only Prometheus was restarted. The Compose API was configured to export OTLP to the existing LGTM endpoint through `host.docker.internal:22918`; only the API container was recreated. The main API and persistent volumes were preserved. The SIGTERM test used a disposable API container on port 3310 and left the main API running.

## Evidence links

- Restore procedure and actual RTO/RPO: RESTORE-DRILL.md
- Official grading matrix: evidence/phase6.2-grading-matrix.md
- Compose smoke invariants: evidence/phase5-compose-verification.json
- Previous deployment artifacts: evidence/base.txt, evidence/base-state.json, evidence/demos.txt
- Final CI/CD deployment run: [run 45640058955](https://github.com/Anastasiya-B/rbdrm-course-project/actions/runs/45640058955)
- Final retained CI artifacts: [evidence/ci-run-45640058955](ci-run-45640058955)
- Observability implementation: `src/observability`, `src/lifecycle.ts`, `demo/demo-logs.sh`, `demo/demo-metrics.mjs`, `demo/demo-trace.sh`, `observability/grafana/dashboards/marketplace-observability.json`
