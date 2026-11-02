# Marketplace API

Course project for Node.js / NestJS.

## Current scope

- OpenAPI contract and runtime validation
- typed configuration and secret handling
- PostgreSQL + TypeORM migrations and deterministic seed
- PgBouncer in transaction pooling mode
- transactional checkout with concurrency protection
- worker pool with `FOR UPDATE SKIP LOCKED`
- retry handling for serialization failures and deadlocks
- integration, E2E and Pact contract tests
- Pact Broker and `can-i-deploy` CI gate
- Socket.IO order-status rooms
- SSE order-status stream with `Last-Event-ID` replay
- RabbitMQ `order.placed` events with manual ack, prefetch and DLQ
- transactional outbox relay and persistent inbox deduplication
- API-level `Idempotency-Key`
- Redis cache-aside with TTL jitter and stampede protection
- Redis-backed rolling sessions
- shared Redis sliding-window rate limit
- BullMQ queue with retries, deduplication and scheduler

## Install and build

```bash
npm ci
npx tsc --noEmit
npm run build
```

Start:

```bash
node dist/main.js
```

## Local infrastructure

```bash
docker compose up -d --wait
```

| Service                        | Address                  |
| ------------------------------ | ------------------------ |
| Marketplace API                | `http://localhost:3000`  |
| PostgreSQL                     | `127.0.0.1:5432`         |
| PgBouncer                      | `127.0.0.1:6432`         |
| RabbitMQ AMQP                  | `amqp://127.0.0.1:5672`  |
| RabbitMQ Management            | `http://127.0.0.1:15672` |
| Redis cache                    | `redis://127.0.0.1:6381` |
| Redis queue/session/rate-limit | `redis://127.0.0.1:6382` |
| Pact Broker                    | `http://127.0.0.1:9292`  |

RabbitMQ development credentials: `app/app`.

The two Redis services intentionally use different eviction policies:

```text
redis-cache -> allkeys-lru + maxmemory > 0
redis-queue -> noeviction
```

Cache data is disposable, while BullMQ and session/rate-limit state must not disappear because Redis evicted a key.

## Database

The application uses PgBouncer on port `6432`.

```text
DB_HOST=127.0.0.1
DB_PORT=6432
DB_USER=marketplace
DB_PASSWORD=marketplace_password
DB_NAME=marketplace
```

Schema setup:

```bash
npm run build
npm run migrate
npm run seed
```

Main tables include:

```text
users
products
orders
order_items
post_processing_tasks
outbox_messages
processed_messages
order_event_effects
idempotency_keys
```

## Transactional outbox

Order creation and its event are committed together:

```text
BEGIN
→ reserve Idempotency-Key
→ INSERT order
→ INSERT order_items
→ INSERT outbox_messages
→ bind key to order
→ COMMIT
```

The relay reads unpublished rows with:

```sql
WHERE published_at IS NULL
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
```

and uses this order:

```text
publish
→ UPDATE published_at
→ COMMIT
```

A relay crash can therefore produce duplicate delivery, but the consumer uses `processed_messages` plus an idempotent effect in one PostgreSQL transaction.

Result:

```text
at-least-once delivery
+
idempotent effect
=
exactly-once result
```

## Realtime order status

### WebSocket

```bash
node scripts/realtime-demo.mjs
node scripts/realtime-demo.mjs --same-room
```

Expected isolation:
Expected isolation:

```text
A_RECEIVED=1
B_RECEIVED=0
```

Same-room control:
Same-room control:

```text
A_RECEIVED=1
B_RECEIVED=1
```

### SSE

Endpoint:

```text
GET /orders/:id/events
```

`Last-Event-ID` supports replay of buffered events.

## Redis: кеш, сесії, ліміти, черга

HW23 adds Redis for performance and ephemeral shared state. Redis does not replace database invariants or idempotency.

### Cache-aside

The cache Redis uses:

```text
maxmemory > 0
maxmemory-policy=allkeys-lru
```

The selected expensive read uses cache-aside:

```text
cache hit → Redis only
cache miss → database → Redis
```

Every cache write has TTL with jitter:

```text
TTL = 300 + random(0..60) seconds
```

The jitter prevents many keys warmed together from expiring at exactly the same second.

### Stampede protection

A cold key uses a single-flight lock:

```text
SET lock:<key> <token> NX PX <ttl>
```

Only the lock winner loads from the database. Other callers wait and re-read the cache.

The lock is released with compare-and-delete through Lua, not a plain `DEL`, so one process cannot delete a lock already acquired by another owner.

If the stampede lock fails, correctness is not affected: the worst result is extra database reads. That is acceptable because this lock protects performance, not a business invariant. Business correctness still belongs to database transactions, unique constraints and idempotency.

### Cache demo

```bash
npm run demo:cache
```

Acceptance output:

```text
cache-lru=1
cache-maxmemory=1
warmed=60
ttl-distinct>=5
concurrent=25
db-calls=1
db-calls-warm=0
```

The cold-key concurrency test proves that at least 20 simultaneous requests result in exactly one database load. The next 100 reads of the warm key result in zero database calls.

### Sessions

Sessions are stored in the `noeviction` Redis instance rather than the LRU cache instance.

This avoids unpredictable logout caused by cache eviction.

Every successful read renews the session TTL:

```text
GET session
→ EXPIRE session <ttl>
```

This is rolling TTL: an active user keeps the session alive.

```bash
npm run demo:session
```

Acceptance output:

```text
requests=3
sessions=1
in-redis=1
ttl-renewed=1
```

### Rate limit

The rate limiter is shared through Redis, so multiple application instances consume the same limit.

The implementation uses a sliding window stored in a sorted set. Cleanup, counting and insertion are executed atomically in one Lua script.

A sliding window was chosen because it avoids the `2 × limit` burst that a fixed window can allow at a boundary.

When the limit is exceeded:

```text
HTTP 429
Retry-After: <seconds>
```

```bash
npm run demo:ratelimit
```

Acceptance output:

```text
instances=2
limit=5
requests=8
allowed=5
blocked=3
status=429
retry-after=1
```

### BullMQ queue

BullMQ uses the separate Redis instance configured with:

```text
maxmemory-policy=noeviction
appendonly=yes
appendfsync=everysec
```

The queue uses:

```text
attempts >= 3
exponential backoff
jitter
jobId deduplication
upsertJobScheduler
```

The worker connection uses:

```text
maxRetriesPerRequest=null
```

Two `add()` calls with the same `jobId` create one queue job.

`removeOnComplete: true` is not used because immediate removal would remove the completed job identity and break the desired deduplication window.

Schedulers use `upsertJobScheduler`, so application restarts do not create duplicate schedulers.

```bash
npm run demo:queue
```

Acceptance output:

```text
queue-noeviction=1
attempts>=3
completed=1
added=2
queued=1
schedulers>=1
scheduled-runs>=2
```

## Why two Redis instances

Cache and BullMQ require incompatible Redis memory policies.

Cache:

```text
allkeys-lru
```

Queue/session/rate-limit:

```text
noeviction
```

`maxmemory-policy` belongs to the Redis process, not to an individual logical database selected with `SELECT`, so one Redis process cannot safely serve both purposes.

Sessions are also kept outside the cache Redis because LRU eviction must never randomly invalidate a user session.

## Secrets

Commands requiring database, broker or Redis access use:

```text
scripts/with-secrets.sh
```

For grading:

```text
SKIP_VAULT=1
```

allows already-provided environment variables to be used without access to the secret store.

HW23 demo scripts:

```text
demo:cache
demo:session
demo:ratelimit
demo:queue
```

All four are wrapped directly in `package.json` with:

```text
bash scripts/with-secrets.sh dev ...
```

All three are wrapped directly in `package.json` with `bash scripts/with-secrets.sh dev ...`.

No live connection strings are stored in tracked `.env` files.

## Testing

Previous tests remain available:

```bash
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
```

## Grading

Run from the repository root:

```bash
docker compose up -d --wait

export REDIS_URL=redis://127.0.0.1:6381
export REDIS_QUEUE_URL=redis://127.0.0.1:6382

export DB_HOST=127.0.0.1
export DB_PORT=6432
export DB_USER=marketplace
export DB_PASSWORD=marketplace_password
export DB_NAME=marketplace
export DB_URL=postgresql://marketplace:marketplace_password@127.0.0.1:6432/marketplace
export DATABASE_URL=postgresql://marketplace:marketplace_password@127.0.0.1:6432/marketplace

export BROKER_URL=amqp://app:app@127.0.0.1:5672
export SKIP_VAULT=1


npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run seed
```

Run HW23 demos:

```bash
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
```

Expected invariants:

```text
demo:cache
cache-lru=1
cache-maxmemory=1
warmed>=50
ttl-distinct>=5
concurrent>=20
db-calls=1
db-calls-warm=0

demo:session
requests>=3
sessions=1
in-redis=1
ttl-renewed=1

demo:ratelimit
instances>=2
allowed=limit
blocked>=1
status=429
retry-after=1

demo:queue
queue-noeviction=1
attempts>=3
completed=1
added=2
queued=1
schedulers>=1
scheduled-runs>=2
```

Verify Redis policies:

```bash
docker exec marketplace-redis-cache redis-cli CONFIG GET maxmemory-policy
docker exec marketplace-redis-cache redis-cli CONFIG GET maxmemory
docker exec marketplace-redis-queue redis-cli CONFIG GET maxmemory-policy
```

Expected invariants:

```text
cache: allkeys-lru
cache maxmemory: > 0
queue: noeviction
```

Static policy check:

```bash
grep -rniE   --exclude-dir=node_modules   --exclude-dir=dist   "maxmemory[ _-]*policy|noeviction|allkeys[ _-]*lru" .
```

Verify demo wrappers:
Verify demo wrappers:

```bash
node -e "const s=require('./package.json').scripts;const bad=['demo:cache','demo:session','demo:ratelimit','demo:queue'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'without wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Expected:

```text
OK
```

Verify README:

```bash
grep -rlE '^#{1,3} +Grading'   --include='README.md'   --exclude-dir=node_modules . | wc -l
grep -rlE '^#{1,3} +Grading'   --include='README.md'   --exclude-dir=node_modules . | wc -l
```

Expected: at least `1`.

Expected: at least `1`.

Verify tracked env files:

```bash
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template|dist)$'); do
  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://[^ ]*:[^ @]+@' "$f"
done
```

Expected: no output.

## Main project structure

```text
src/
├── config/
├── entities/
├── migrations/
├── orders/
├── outbox/
├── rabbitmq/
├── redis/
│   ├── cache.ts
│   ├── product-cache.ts
│   ├── session.ts
│   ├── rate-limit.ts
│   └── queue.ts
├── repositories/
├── checkout.ts
├── data-source.ts
├── database.service.ts
├── demo-cache.ts
├── demo-session.ts
├── demo-ratelimit.ts
├── demo-queue.ts
├── demo-outbox.ts
├── demo-crash-write.ts
├── demo-crash-relay.ts
├── seed.ts
└── main.ts


scripts/
├── with-secrets.sh
└── realtime-demo.mjs


test/
├── integration/
├── e2e/
└── contract/
```

## Submission

Submit the Pull Request from the `hw-23` branch.
