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
| Deployment evidence | inspect evidence/base*, evidence/demos.txt, workflows | previous artifacts present; no accepted external run URL or six-zero teardown transcript recorded | PARTIAL |

## Runtime and troubleshooting notes

Docker Desktop/Testcontainers is required for integration/E2E infrastructure. The local environment previously required removing CODEX_CI for test commands; workflows use env -u CODEX_CI. If Docker uses a different local socket, configure Docker Desktop or set a shell-local DOCKER_HOST; no personal absolute socket is part of the repository.

No development database or persistent volume was reset. Restore used a dedicated temporary restore container and volume. Cleanup-heavy demos were not forced against shared state.

## Evidence links

- Restore procedure and actual RTO/RPO: RESTORE-DRILL.md
- Official grading matrix: evidence/phase6.2-grading-matrix.md
- Compose smoke invariants: evidence/phase5-compose-verification.json
- Previous deployment artifacts: evidence/base.txt, evidence/base-state.json, evidence/demos.txt
