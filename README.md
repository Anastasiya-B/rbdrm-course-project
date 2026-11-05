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

## Auth

HW24 adds short-lived RS256 access JWTs, opaque rotating refresh tokens, reuse detection, logout revocation, RBAC and resource ownership checks.

### Tokens

Access token:

```text
format: JWT
algorithm: RS256
lifetime: 10 minutes
claims: sub, role, jti, familyId
```

Refresh token:

```text
format: opaque random string
storage: HMAC-SHA256 hash only
lifetime: 30 days
family: family_id
```

The raw refresh token is never stored in PostgreSQL. `token_hash` is calculated with HMAC and `REFRESH_TOKEN_PEPPER`.

### Auth variables

| Змінна                 | Джерело            | Навіщо                                     |
| ---------------------- | ------------------ | ------------------------------------------ |
| `JWT_KID`              | сховище (#11)      | active signing-key identifier              |
| `JWT_PRIVATE_KEY`      | сховище (#11)      | RS256 signing key, base64-encoded PEM      |
| `JWT_PUBLIC_KEY`       | сховище (#11)      | RS256 verification key, base64-encoded PEM |
| `REFRESH_TOKEN_PEPPER` | сховище (#11)      | HMAC pepper for refresh-token hashes       |
| `DATABASE_URL`         | compose / оточення | PostgreSQL connection                      |
| `REDIS_URL`            | compose / оточення | cache Redis                                |
| `REDIS_QUEUE_URL`      | compose / оточення | queue/session/rate-limit Redis             |
| `BROKER_URL`           | compose / оточення | RabbitMQ connection                        |

There are no defaults for authentication secrets. Plain `npm run start` fails before database connection and names a missing auth variable. `npm run start:vault` and the auth demos use `scripts/with-secrets.sh`.

### RS256 and explicit algorithm allowlist

RS256 is used for compatibility with the course grading setup and clear asymmetric signing/verification separation. Verification explicitly allows only `RS256`; trust decisions never use `decode()` alone. A token with a modified payload and unchanged signature is rejected with `401`.

### Refresh rotation and reuse detection

A successful refresh marks the presented token as used and inserts the next token in the same `family_id` within one transaction. Reuse of an already-used refresh token is treated as compromise: the whole family is revoked, so the already-issued successor also returns `401`.

The intended client strategy is to serialize refresh requests with one in-flight refresh promise, avoiding false-positive reuse detection from parallel client refreshes.

### Why logout is two actions

Logout must invalidate two different token types. The refresh family is server-side state and is marked `revoked_at`. The access JWT is self-contained and would otherwise survive until `exp`, so its `jti` is inserted into `access_token_denylist` until token expiry. Both writes are in PostgreSQL and are committed in one transaction, avoiding a new cross-storage dual-write window.

### 401 vs 403

```text
missing / expired / invalid / revoked token -> 401
valid token, wrong role                 -> 403
valid token, foreign resource           -> 403
```

### RBAC and ownership

Product creation requires `seller` or `admin`; a buyer gets `403`. `GET /orders/:id` authenticates first, then checks ownership against `orders.user_id`. Ownership is intentionally not inside the auth guard because the guard does not own resource data.

The `role` claim is a cache, not the ultimate source of truth. A freshly demoted admin may keep admin rights until the short access token expires. Immediate permission revocation would require an online authorization lookup or another revocation mechanism.

### Signing-key rotation and `kid`

`kid` identifies the signing key. During overlap rotation, new tokens are signed by the new private key while both old and new public keys remain available for verification. After the maximum lifetime of old access tokens passes, the old public key can be removed.

### Dev / prod key fingerprints

Private keys are never committed. Public-key SHA-256 fingerprints can be generated with:

```bash
echo "$JWT_PUBLIC_KEY" \
  | base64 --decode \
  | openssl pkey -pubin -outform DER 2>/dev/null \
  | openssl dgst -sha256
```

Development and production public-key fingerprints:

```text
dev  = ca8f2d35a48d5d789b94b6c53f79467020ad408e66f5984d6c0cf9c4d5b36e75
prod = 4aec32999a9c23fbae73466a7550f6b1f944db9349017bc32c945f028c94e07d
```

The two fingerprints must differ.

### Auth demos

```bash
npm run demo:auth
npm run demo:reuse
npm run demo:rbac
```

Expected:

```text
demo:auth
login=200
no-token=401
with-token=200
refresh=200
logout=200|204
after-logout=401
refresh-after-logout=401

demo:reuse
login=200
r1-refresh=200
r1-reuse=401
r2-after-reuse=401

demo:rbac
anon=401
own=200
foreign=403
role-denied=403
role-allowed=200|201
tampered=401
```

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

Run from the repository root.

```bash
docker compose up -d --wait

export DB_HOST=127.0.0.1
export DB_PORT=6432
export DB_USER=marketplace
export DB_PASSWORD=marketplace_password
export DB_NAME=marketplace
export DB_URL=postgresql://marketplace:marketplace_password@127.0.0.1:6432/marketplace
export DATABASE_URL=postgresql://marketplace:marketplace_password@127.0.0.1:6432/marketplace

export REDIS_URL=redis://127.0.0.1:6381
export REDIS_QUEUE_URL=redis://127.0.0.1:6382
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export SKIP_VAULT=1
```

Generate a one-time RS256 pair for grading:

```bash
node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("rsa",{modulusLength:2048,
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'

export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER=grader-pepper
```

Prepare the project:

```bash
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run seed
```

Verify wrappers:

```bash
node -e "const s=require('./package.json').scripts;const need=['start:vault','demo:auth','demo:reuse','demo:rbac'];const bad=need.filter(k=>/with-secrets\\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'without wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"

grep -q 'SKIP_VAULT' scripts/with-secrets.sh && echo "emergency bypass present"
```

Run auth demos:

```bash
npm run demo:auth
npm run demo:reuse
npm run demo:rbac
```

Expected invariants are documented in `## Auth`.

Verify explicit algorithm allowlist:

```bash
grep -rniE --include='*.ts' --include='*.js' --exclude-dir=node_modules --exclude-dir=dist "algorithms[[:space:]]*[:=,}]|['\"]algorithms['\"]|algorithms\(" .
```

Expected: at least one match.

Verify no private key is tracked:

```bash
git ls-files -z \
  | grep -zv '^README.md$' \
  | xargs -0 grep -lE \
  'BEGIN ([A-Z]+ )?PRIVATE KEY|LS0tLS1CRUdJTiBQUklWQVRF|LS0tLS1CRUdJTiBSU0EgUFJJ|LS0tLS1CRUdJTiBFQyBQUklW'
```

Expected: no output.

Verify tracked env files:

```bash
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template|dist)$'); do
  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://[^ ]*:[^ @]+@' "$f"
done
```

Expected: no output.

Verify README sections:

```bash
grep -rlE '^#{1,3} +Grading' --include='README.md' --exclude-dir=node_modules . | wc -l
grep -rlE '^#{1,3} +Auth' --include='README.md' --exclude-dir=node_modules . | wc -l
```

Expected: both values are at least `1`.

## Main project structure

```text
src/
├── auth/
│   ├── access-denylist.ts
│   ├── auth.config.ts
│   ├── auth.controller.ts
│   ├── auth.guard.ts
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── auth.tokens.ts
│   ├── password.ts
│   ├── roles.decorator.ts
│   └── roles.guard.ts
├── config/
├── entities/
├── migrations/
├── orders/
├── outbox/
├── rabbitmq/
├── redis/
├── repositories/
├── demo-auth.ts
├── demo-reuse.ts
├── demo-rbac.ts
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

Submit the Pull Request from the `hw-24` branch.
