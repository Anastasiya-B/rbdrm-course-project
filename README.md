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
- transactional outbox relay
- persistent inbox deduplication
- API-level `Idempotency-Key`

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

| Service             | Address                  |
| ------------------- | ------------------------ |
| Marketplace API     | `http://localhost:3000`  |
| PostgreSQL          | `127.0.0.1:5432`         |
| PgBouncer           | `127.0.0.1:6432`         |
| RabbitMQ AMQP       | `amqp://127.0.0.1:5672`  |
| RabbitMQ Management | `http://127.0.0.1:15672` |
| Pact Broker         | `http://127.0.0.1:9292`  |

RabbitMQ development credentials: `app/app`.

## Database

The application uses PgBouncer on port `6432`.

```text
DB_HOST=127.0.0.1
DB_PORT=6432
DB_USER=marketplace
DB_PASSWORD=marketplace_password
DB_NAME=marketplace
```

Run schema setup:

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

### Checkout and concurrency

Checkout uses a single transaction for the business state.

Stock protection uses an atomic conditional update:

```sql
UPDATE products
SET stock_quantity = stock_quantity - $1
WHERE id = $2
  AND stock_quantity >= $1
RETURNING id, price, stock_quantity;
```

Useful earlier demos:

```bash
npm run demo:race
npm run demo:workers
npm run demo:retry
```

Workers use `FOR UPDATE SKIP LOCKED`. Retry logic handles PostgreSQL `40001` and `40P01`.

## Testing

```bash
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
```

Integration tests use PostgreSQL Testcontainers and real SQL. E2E tests start the full Nest application. Pact verifies the `MarketplaceFrontend -> MarketplaceAPI` contract. CI includes Pact Broker and `can-i-deploy`.

## Realtime order status

### WebSocket

Socket.IO clients send `join` with an order id. A socket joins `orders:<id>` only after ownership validation.

```bash
node scripts/realtime-demo.mjs
node scripts/realtime-demo.mjs --same-room
```

Expected isolation:

```text
A_RECEIVED=1
B_RECEIVED=0
```

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

Event format:

```text
id: 1
event: order.status
data: {"orderId":1,"status":"paid","occurredAt":"..."}
```

`Last-Event-ID` replays buffered events with larger ids.

## Trade-offs: WebSocket vs SSE

| Criterion      | WebSocket                                 | SSE                                       |
| -------------- | ----------------------------------------- | ----------------------------------------- |
| Direction      | Bidirectional                             | Server to client                          |
| Reconnect      | Supported, replay is custom               | Built in, `Last-Event-ID` supports replay |
| Infrastructure | Needs WebSocket-aware proxy/load balancer | Standard HTTP streaming                   |
| Best fit       | Interactive realtime flows                | Notifications and status feeds            |

For order-status notifications, SSE is simpler when the client only receives updates. WebSocket is preferable for frequent bidirectional communication.

With multiple application instances, Socket.IO rooms and in-memory replay must move to shared infrastructure such as the Socket.IO Redis adapter and shared replay storage.

## RabbitMQ delivery

RabbitMQ topology:

```text
exchange: shop.events
routing key: order.placed
queue: shop.order.placed
DLX: shop.events.dlx
DLQ: shop.order.placed.dlq
queue type: quorum
prefetch: 10
```

The producer uses a confirm channel and waits for broker confirms. The consumer uses manual acknowledgements and acknowledges only after the effect is complete.

Delivery is **at-least-once**. Exactly-once delivery is not assumed.

## Outbox та ідемпотентність

HW22 removes the dual-write gap between PostgreSQL business state and RabbitMQ publication.

### Transactional outbox

Order creation and its outbox row are written in the same database transaction:

```text
BEGIN
→ reserve Idempotency-Key
→ INSERT order
→ INSERT order_items
→ INSERT outbox_messages
→ bind Idempotency-Key to order
→ COMMIT
```

The producer is not called from inside this business transaction.

The outbox event contains an explicit public contract instead of spreading a database or ORM entity.

Main outbox fields:

```text
event_id
aggregate_type
aggregate_id
type
payload
created_at
published_at
attempts
```

Unpublished messages are found through a partial index using:

```sql
WHERE published_at IS NULL
```

### Relay

The polling relay selects pending messages with:

```sql
SELECT ...
FROM outbox_messages
WHERE published_at IS NULL
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
LIMIT $1;
```

For each row the order is:

```text
publish
→ UPDATE published_at
→ COMMIT
```

`publish` must happen before `UPDATE published_at`.

If `published_at` were updated first and the process failed before publish, the event would be permanently lost. With publish first, a crash can create a duplicate, but duplicates can be safely handled with idempotency.

The demo uses a **simulated relay crash**: an exception is thrown after broker publish confirmation but before `UPDATE published_at`.

### Consumer idempotency

The consumer uses two levels of protection.

Level 1 — natural effect key:

```sql
INSERT INTO order_event_effects (...)
ON CONFLICT (message_id)
DO NOTHING;
```

Level 2 — persistent inbox:

```text
processed_messages(message_id, consumer)
```

The inbox marker and the effect are written in the **same PostgreSQL transaction**.

Therefore a duplicate delivery is observable, but the effect is applied only once.

This gives:

```text
at-least-once delivery
+
idempotent effect
=
exactly-once result
```

### API Idempotency-Key

`POST /orders` requires:

```text
Idempotency-Key
```

Two requests with the same key represent the same intent and return the same order.

The key is not derived from a request-body hash, so two intentional identical orders can still be created by using different keys.

### Ordering

`ORDER BY created_at, id` only controls relay selection order.

It does **not** guarantee global broker delivery order because multiple relay workers can process rows concurrently through `SKIP LOCKED`.

If strict ordering is required, it must be designed around an aggregate or partitioning key.

### Outbox cleanup

Published outbox rows must not grow forever.

A production system should periodically archive or delete old rows where `published_at IS NOT NULL`, while keeping enough retention for diagnostics and replay requirements.

### Demo results

Happy path:

```bash
npm run demo:outbox
```

Measured result:

```text
requests=2
orders=1
outbox=1
published=1
deliveries=1
effect=1
processed=1
```

Business transaction failure:

```bash
npm run demo:crash-write
```

Measured result:

```text
write-failed=1
orders=0
outbox=0
published=0
deliveries=0
effect=0
```

Relay failure:

```bash
npm run demo:crash-relay
```

Measured result:

```text
published=2
deliveries=2
applied=1
effect=1
processed=1
```

The first relay publishes and fails before `published_at` is committed. The next relay sees the same pending outbox row and publishes it again.

The consumer receives the event at least twice, but the persistent inbox and idempotent effect keep the business result at one.

## Secrets

Commands that need database or broker credentials use:

```text
scripts/with-secrets.sh
```

For grading, `SKIP_VAULT=1` allows already-provided environment variables to be used without access to the secret store.

HW22 demo scripts:

```text
demo:outbox
demo:crash-write
demo:crash-relay
```

All three are wrapped directly in `package.json` with `bash scripts/with-secrets.sh dev ...`.

No live connection strings are stored in tracked `.env` files.

## Grading

Run from the repository root:

```bash
docker compose up -d --wait

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

Run HW22 demos:

```bash
npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay
```

Expected invariants:

```text
demo:outbox
requests=2
orders=1
outbox=1
published=1
effect=1
processed=1

demo:crash-write
write-failed=1
orders=0
outbox=0
published=0
deliveries=0
effect=0

demo:crash-relay
deliveries>=2
applied=1
effect=1
processed=1
```

Verify `SKIP LOCKED`:

```bash
grep -rniE   --include='*.ts'   --exclude-dir=node_modules   --exclude-dir=dist   "skip[ _-]*locked" .
```

Verify conflict-based deduplication:

```bash
grep -rniE   --include='*.ts'   --exclude-dir=node_modules   --exclude-dir=dist   "on[ _]*conflict|do[ _]+nothing|or[ _]*ignore|skip[ _]*duplicates|ignore[ _]*duplicates|23505|P2002" .
```

Verify demo wrappers:

```bash
node -e "const s=require('./package.json').scripts;const bad=['demo:outbox','demo:crash-write','demo:crash-relay'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'without wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Verify README grading section:

```bash
grep -rlE '^#{1,3} +Grading'   --include='README.md'   --exclude-dir=node_modules . | wc -l
```

Expected: at least `1`.

Verify tracked env files:

```bash
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template|dist)$'); do
  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://[^ ]*:[^ @]+@' "$f"
done
```

Expected: no output.

Previous checks remain available:

```bash
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
node scripts/realtime-demo.mjs
node scripts/realtime-demo.mjs --same-room
```

## Main project structure

```text
src/
├── config/
├── entities/
├── migrations/
├── orders/
├── outbox/
│   ├── order-placed-event.ts
│   ├── outbox-relay.ts
│   ├── outbox.repository.ts
│   └── run-relay.ts
├── rabbitmq/
│   ├── broker.ts
│   ├── order-placed.consumer.ts
│   ├── order-placed.event.ts
│   ├── order-placed-message.ts
│   ├── order-placed.publisher.ts
│   └── topology.ts
├── repositories/
├── checkout.ts
├── data-source.ts
├── database.service.ts
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

Submit the Pull Request from the `hw-22` branch.
