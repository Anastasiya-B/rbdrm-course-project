# Phase 6.2 verification evidence

Captured 2026-11-25 on branch `course-project`. Secret values and tokens are intentionally omitted.

| Criterion | Command / source | Exit/result | Status |
|---|---|---:|---|
| 11.3 database performance | `docker compose exec postgres psql ... EXPLAIN (ANALYZE, BUFFERS) ...` | Index Scan on products PK; 3 shared buffers; 0.112 ms execution | VERIFIED for captured query |
| 11.3 N+1 elimination | `docker run --network marketplace-course_default ... node dist/demo-nplus1.js` | N=5: 14 to 1 queries; N=10: 25 to 1; optimized count constant | VERIFIED |
| PgBouncer | `psql -h pgbouncer -p 6432 -d pgbouncer -c 'SHOW POOLS' -c 'SHOW CONFIG'` | `pool_mode=transaction`; pool row captured; no secret output | VERIFIED |
| Backup restore | `DATABASE_URL=... bash scripts/restore-drill.sh` | Fresh `marketplace_2026-11-25_15-24-54.dump`; source/restored `32|8880400`; 48K; RTO 6 s; `MATCH`; exit 0 | VERIFIED |
| Redis session | `npm run demo:session` | requests=3, sessions=1, in-redis=1, ttl-renewed=1 | VERIFIED for session demo |
| Redis cache | `npm run demo:cache` | Shell invocation failed before demo: missing `DB_HOST`; cache demo also flushes cache DB, so not rerun against shared stack | BLOCKED |
| File storage/CDN | `npm run demo:upload`, `demo:multipart`, `demo:cdn` | Shell invocation failed before demo: missing storage variables; destructive cleanup in demos prevents shared-stack rerun | BLOCKED |
| Authentication/RBAC | `npm run demo:auth`, `demo:reuse`, `demo:rbac` | Shell invocation failed before demo: missing `DB_HOST`; demos clean shared auth/product rows | BLOCKED |
| Realtime | `BASE_URL=http://localhost:3300 node scripts/realtime-demo.mjs` | `paid`; ownerJoin=true; foreignJoinRejected=true; invalidJwtRejected=true; ownerReceived=true; foreignReceived=0; sseReplayObserved=true; exit 0 | VERIFIED |
| RabbitMQ | container health and logs | health check currently reports healthy; booted; app authenticated; queues present | VERIFIED for health/connectivity |
| Docker image | `npm run image:build` | exit 0; multi-stage build completed | VERIFIED |
| Image runtime security | `docker image inspect rbdrm-marketplace:hw28` | entrypoint `/nodejs/bin/node`; user `65532:65532`; shell null; only PATH/SSL_CERT_FILE/NODE_ENV env names | VERIFIED |
| Vulnerability gate | `npm run scan` | HIGH,CRITICAL found=9; max-allowed=10; gate=pass | VERIFIED with 9 findings |
| Existing deployment evidence | `evidence/base.txt`, `evidence/demos.txt`, `evidence/base-state.json`, CI workflows | prior HW31/HW32 artifacts present; not rerun or fabricated | PARTIAL / reuse existing evidence |

## Regression results

- `npm run build`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run architecture`: exit 0; 141 modules and 372 dependencies, no violations.
- `npm run check:env`: exit 0; `.env.example` synchronized.
- `npm run test:unit`: exit 0, but Jest emitted no test-count summary in this environment.
- `npm run test:integration`: exit 0; 3 suites, 7 tests passed.
- `npm run test:e2e`: 1 suite and 9 tests passed, including the 50-request concurrency test; Jest left open handles, so the process was interrupted after the complete passing summary (shell exit 130).
- `npm run test:contract`: exit 0, but no Jest count summary was emitted.
- `npm run verify:provider`: exit 0, but no Jest count summary was emitted.
- `git diff --check`: passed after removing an extra README EOF blank line.

## Safety notes

No database or persistent application volume was reset. The restore drill used its dedicated temporary container/volume and cleaned those resources. Authentication, RBAC, upload, multipart, CDN, and cache demos were not forced against the shared stack because their existing cleanup/reset behavior conflicts with the project instruction not to reset shared databases or cache state.
