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
- RabbitMQ `order.placed` events with manual ack, prefetch, DLQ and persistent deduplication

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

```bash
npm run build
npm run migrate
npm run seed
```

Main tables: `users`, `products`, `orders`, `order_items`, `post_processing_tasks`. HW19 adds `processed_order_events` for persistent RabbitMQ deduplication.

### Checkout and concurrency

Checkout runs in one transaction:

- atomic stock decrement
- buyer balance decrement
- order creation
- order item creation
- post-processing task creation

Stock protection:

```sql
UPDATE products
SET stock_quantity = stock_quantity - $1
WHERE id = $2
  AND stock_quantity >= $1
RETURNING id, price, stock_quantity;
```

Useful demos:

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

Integration tests use PostgreSQL Testcontainers and real SQL. E2E tests start the full Nest app. Pact verifies the `MarketplaceFrontend -> MarketplaceAPI` contract. CI includes Pact Broker and `can-i-deploy`.

## Realtime order status

### WebSocket

Socket.IO clients send `join` with an order id. A socket joins `orders:<id>` only after ownership validation.

```bash
node scripts/realtime-demo.mjs
node scripts/realtime-demo.mjs --same-room
```

Expected:

```text
A_RECEIVED=1
B_RECEIVED=0
```

Same-room:

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

With multiple app instances, Socket.IO rooms and in-memory replay are not shared. Use the Socket.IO Redis adapter and shared replay storage.

## Async-події через RabbitMQ

HW19 adds a durable broker path for `order.placed`.

### Topology

- topic exchange: `shop.events`
- routing key: `order.placed`
- work queue: `shop.order.placed`
- DLX: `shop.events.dlx`
- DLQ: `shop.order.placed.dlq`
- queue type: quorum
- prefetch: `10`

Topology is declared by the consumer/bootstrap side. The producer only publishes.

### Event contract

```text
eventId
type
occurredAt
data.orderId
data.userId
data.productId
data.quantity
data.totalAmount
```

Stable event id:

```text
order.placed:<orderId>
```

The producer uses a confirm channel and waits for broker confirms.

### Delivery semantics

The consumer uses `noAck=false` and acknowledges only after the effect.

This is **at-least-once delivery**, not exactly-once delivery. A message may be redelivered if the effect completed but the acknowledgement did not reach RabbitMQ.

The exactly-once result comes from at-least-once delivery plus an idempotent consumer effect. Processed event ids are persisted in PostgreSQL in `processed_order_events`, so deduplication survives restarts and works across instances.

There is still a failure window between the checkout database commit and RabbitMQ publish. HW19 does not make PostgreSQL and RabbitMQ atomic; transactional outbox will close this gap in HW22. The processed-event marker and a future real business effect should also be committed in one DB transaction.

### Prefetch

The consumer uses:

```text
prefetch=10
```

Even with a conservative 1 second processing time, `10 × 1s = 10s`, far below the default 30 minute `consumer_timeout`.

### DLQ

The work queue uses `x-dead-letter-exchange` and `x-dead-letter-routing-key`. Invalid messages are rejected with `requeue=false`. The demo reads `x-death` and verifies the reason.

### Demo results

Happy path:

```bash
npm run demo:publish
```

```text
published=5
delivered=5
effect=5
acked=5
dlq=0
prefetch=10
```

DLQ:

```bash
npm run demo:dlq
```

```text
rejected=1
work=0
dlq=1
dlq-reason=rejected
effect=0
```

Duplicate:

```bash
npm run demo:duplicate
```

```text
deliveries=2
effect=1
skipped=1
```

The duplicate demo applies the effect once and uses `nack(..., requeue=true)` to force redelivery. The repeated event is skipped by persistent deduplication.

## Secrets

Commands that need database or broker credentials use `scripts/with-secrets.sh`.

For grading, `SKIP_VAULT=1` allows already-provided environment variables to be used without vault access.

RabbitMQ demo scripts:

```text
demo:publish
demo:dlq
demo:duplicate
```

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

HW19:

```bash
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
```

Expected:

```text
demo:publish
published=5
effect=5
dlq=0
prefetch=10

demo:dlq
work=0
dlq=1
dlq-reason=rejected
effect=0

demo:duplicate
deliveries=2
effect=1
```

Verify wrappers:

```bash
node -e "const s=require('./package.json').scripts;const bad=['demo:publish','demo:dlq','demo:duplicate'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'without wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Verify DLX:

```bash
grep -rniE --include='*.ts' --include='*.js' --include='*.mjs' --include='*.cjs'   --include='*.json' --include='*.sh' --include='*.yml' --include='*.yaml' --include='*.sql'   --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git   "dead[ _-]*letter[ _-]*(exchange|routing)" .
```

Verify prefetch:

```bash
grep -rniE --include='*.ts' --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.json'   --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git   "prefetch|basic[._-]?qos" .
```

Verify tracked env files:

```bash
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template|dist)$'); do
  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://[^ ]*:[^ @]+@' "$f"
done
```

Expected: no output.

Previous checks:

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
├── rabbitmq/
│   ├── broker.ts
│   ├── order-placed.consumer.ts
│   ├── order-placed.event.ts
│   ├── order-placed.publisher.ts
│   └── topology.ts
├── repositories/
├── checkout.ts
├── data-source.ts
├── database.service.ts
├── demo-rabbit-publish.ts
├── demo-rabbit-dlq.ts
├── demo-rabbit-duplicate.ts
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

Submit the Pull Request from the `hw-19` branch.
