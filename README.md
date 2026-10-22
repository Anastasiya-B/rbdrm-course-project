# Marketplace API

Course project for Node.js / NestJS.
The project currently includes:

- OpenAPI contract and runtime validation
- typed configuration and secret handling
- PostgreSQL schema and query optimization
- TypeORM entities, relations and migrations
- deterministic seed data
- N+1 demonstration and fix
- QueryBuilder reporting
- transactional checkout with concurrency protection
- worker pool with `FOR UPDATE SKIP LOCKED`
- retry handling for serialization failures and deadlocks
- PgBouncer in transaction pooling mode
- PostgreSQL custom-format backups
- repeatable restore drill with RTO/RPO verification
- integration tests against real PostgreSQL with Testcontainers
- E2E tests through the full Nest application with Supertest
- Pact consumer/provider contract verification
- Pact Broker and can-i-deploy contract gate in CI

## Install

```bash
npm ci
```

## Build

```bash
npm run build
npx tsc --noEmit
```

## PostgreSQL

Start PostgreSQL and PgBouncer:

```bash
docker compose up -d --wait
```

Development database credentials are defined in `docker-compose.yml`.
The application connects to PostgreSQL through PgBouncer:

```text
DB_HOST=127.0.0.1
DB_PORT=6432
DB_USER=marketplace
DB_PASSWORD=marketplace_password
DB_NAME=marketplace
```

PostgreSQL itself is still exposed on port `5432`, while application/database client traffic for the project uses PgBouncer on port `6432`.

## TypeORM data layer

The HW12 SQL schema is represented by TypeORM entities:

```text
src/entities/
├── user.entity.ts
├── product.entity.ts
├── order.entity.ts
├── order-item.entity.ts
└── post-processing-task.entity.ts
```

`order_items` is an explicit join entity because the relation contains its own data: `quantity`, `unit_price` and timestamps.
Money values in the TypeORM model are stored as integers in minor currency units:

```text
249900 = 2499.00
129900 = 1299.00
```

### Relations and onDelete

The main relations are:

- `User -> Product`
- `User -> Order`
- `Order -> OrderItem`
- `Product -> OrderItem`
- `Order -> PostProcessingTask`
  Deletion behavior:
- `Order -> OrderItem` and `Order -> PostProcessingTask` use `CASCADE` because these rows belong to the order.
- user/product parent relations use `RESTRICT` to protect referenced historical data.

## Migrations

TypeORM schema synchronization is disabled:

```ts
synchronize: false;
```

The schema is created and changed only through migrations:

```bash
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
```

The initial migration creates the marketplace tables, foreign keys, checks and HW12 indexes.
The HW14 migration adds:

- `users.balance`
- `post_processing_tasks`
- queue constraints and indexes
  Detailed HW12 query plans remain in:

```text
db/OPTIMIZATIONS.md
```

## Seed

The seed is deterministic and idempotent:

```bash
npm run build
npm run seed
npm run seed
```

Check row counts:

```bash
docker compose exec postgres psql -U marketplace -d marketplace -c "SELECT
&#x20; (SELECT count(*) FROM users) AS users,
&#x20; (SELECT count(*) FROM products) AS products,
&#x20; (SELECT count(*) FROM orders) AS orders,
&#x20; (SELECT count(*) FROM order_items) AS order_items;"
```

Expected counts after either run:

```text
users:       10
products:    10
orders:      10
order_items: 14
```

The seed also restores buyer balances and the race-test product stock so concurrency demos are repeatable.

## N+1 demonstration

Run:

```bash
npm run build
npm run demo:nplus1
```

The demo loads:

```text
order -> items -> product
```

Measured result:

```text
N = 5: before 14, after 1
N = 10: before 25, after 1
```

The naive version loads items per order and products per item. The optimized version uses `leftJoinAndSelect` for both relation levels, so the graph is loaded with one SQL query.

## QueryBuilder report

Run:

```bash
npm run build
npm run report
```

The report calculates:

- number of orders
- units sold
- revenue in minor currency units
- cancelled orders excluded
  It uses `createQueryBuilder().getRawMany()` with `JOIN`, `GROUP BY` and aggregate functions.
  Verify grouping:

```bash
grep -rniE "\\.(add)?groupBy\\(" src/
```

### Repository vs QueryBuilder

Repository methods are used for ordinary CRUD and simple filters when the result maps directly to entities.
QueryBuilder is used for joins, aggregation, grouping, calculated columns and other SQL that cannot be expressed clearly with `find()`.

## Concurrency

### Transactional checkout

Checkout runs in a single transaction and performs:

- atomic stock decrement
- buyer balance decrement
- order creation
- order item creation
- post-processing task creation
  Stock protection uses an atomic statement:

```sql
UPDATE products
SET stock_quantity = stock_quantity - $1
WHERE id = $2
&#x20; AND stock_quantity >= $1
RETURNING id, price, stock_quantity
```

This approach was chosen instead of a separate read-modify-write flow because PostgreSQL checks available stock and performs the decrement atomically. Concurrent requests therefore cannot oversell the product. If stock or balance is insufficient, the whole transaction is rolled back.

### Race demo

Run:

```bash
npm run demo:race
```

Measured result:

```text
Attempts: 50
Successful: 10
Final stock: 0
Negative stock rows: 0
Invariant passed: true
```

The test runs 50 checkout calls concurrently against one product with initial stock `10` and quantity `1`.

### Worker pool

Run:

```bash
npm run demo:workers
```

Workers claim queue rows with `FOR UPDATE SKIP LOCKED` and keep the transaction open while processing the task.
Measured result:

```text
worker-1: 4
worker-2: 3
worker-3: 3
Total tasks: 10
Processed once: 10
Processed twice: 0
Elapsed: 861 ms
Sequential estimate: 2000 ms
Active workers: 3
Invariant passed: true
```

The worker pool is faster than sequential processing and every task is committed exactly once.

### Retry pattern

Run:

```bash
npm run demo:retry
```

Measured result:

```text
transaction-2: caught 40001, retry 1/5 after 50 ms
Initial balance: 1000000
Increment per transaction: 1000
Expected final balance: 1002000
Actual final balance: 1002000
Invariant passed: true
```

The retry wrapper catches only PostgreSQL `40001` (serialization failure) and `40P01` (deadlock detected). These errors are transient and safe to retry from the beginning of the transaction. Business errors and unrelated database errors are propagated instead of being retried.

## Data layer ops

### PgBouncer

PgBouncer runs in front of PostgreSQL and is exposed on port `6432`.
Configuration:

```text
pgbouncer/pgbouncer.ini
pgbouncer/userlist.txt
```

The pool uses:

```ini
pool_mode = transaction
default_pool_size = 5
max_client_conn = 200
```

Transaction mode is used because API requests perform short database transactions and do not need to keep one dedicated PostgreSQL connection for the lifetime of a client connection. This allows more client connections to share a smaller server-side connection pool.
Transaction pooling does not preserve session state between transactions. Session-level settings such as `SET`, temporary tables tied to a session, and session-level advisory locks cannot be relied on across transactions. Features that depend on a stable backend session, including `LISTEN`/`NOTIFY` listeners, also need special handling. Prepared statements can require PgBouncer-specific support, so `max_prepared_statements` is configured.
Verify PgBouncer:

```bash
PGPASSWORD=marketplace_password psql   -h 127.0.0.1   -p 6432   -U marketplace   -d marketplace   -c "SELECT 1;"
```

Admin console:

```bash
PGPASSWORD=marketplace_password psql   -h 127.0.0.1   -p 6432   -U marketplace   -d pgbouncer   -c "SHOW POOLS;"
```

### Backup

Backups are stored in the local `backups/` directory and use PostgreSQL custom format (`pg_dump -Fc`).
The backup script is:

```text
scripts/backup.sh
```

Run:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
```

The script creates a dated artifact such as:

```text
backups/marketplace_2026-09-30_12-14-24.dump
```

The nightly backup schedule is stored in:

```text
backup.cron
```

Validate a backup:

```bash
LATEST_BACKUP="$(ls -t backups/*.dump | head -n 1)"
docker run --rm   -v "$PWD/backups:/backups:ro"   postgres:16   pg_restore --list "/backups/$(basename "$LATEST_BACKUP")"
```

### Restore drill

The restore drill is:

```text
scripts/restore-drill.sh
```

Run:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

The drill:

- selects the latest backup
- creates a new temporary PostgreSQL container
- creates a fresh Docker volume
- restores the custom-format dump
- compares the `orders` row count and `sum(total_amount)` before and after restore
- prints `MATCH` when both values are identical
- removes the temporary container and volume after the run
  Measured result:

```text
Source checksum: 10|8378600
Restored checksum: 10|8378600
Backup size: 24K
RTO: 7 seconds
MATCH
```

Detailed restore results and recovery objectives are documented in:

```text
RESTORE-DRILL.md
```

Current values:

```text
RTO: 7 seconds
RPO: up to 24 hours
```

## Testing

HW16 adds three test layers: integration tests against a real PostgreSQL container, E2E tests through the full Nest application, and Pact contract tests for the Marketplace API.

### Integration tests

Run:

```bash
npm run test:integration
```

The suite uses `@testcontainers/postgresql` with `postgres:16-alpine`. The PostgreSQL container is created directly from the tests, migrations are applied automatically, and repositories execute real SQL instead of mocks.
The integration suite covers two repositories with three tests each:

```text
ProductRepository: 3 tests
UserRepository:    3 tests
Total:             6 tests
```

The suite includes PostgreSQL unique constraint (`23505`), foreign-key constraint (`23503`), `JOIN` behavior and `ON CONFLICT DO NOTHING`.
Test data builders are located in:

```text
test/integration/testkit/builders.ts
```

#### Isolation strategy

Integration tests use a transaction-per-test strategy. Each test gets a dedicated PostgreSQL client, starts `BEGIN`, and finishes with `ROLLBACK`, so data created by one test is not committed into the next test.
This strategy is fast, deterministic, and avoids manual cleanup. Repeated runs stay green without resetting the database:

```bash
npm run test:integration && npm run test:integration
```

### E2E tests

Run:

```bash
npm run test:e2e
```

The E2E suite starts a real PostgreSQL Testcontainer and creates the full Nest application with `Test.createTestingModule({ imports: [AppModule] })`. No application providers are replaced with mocks.
Covered scenarios:

```text
POST /orders → 201
GET /orders/{id} → 200
GET /orders/999999 → 404
```

### Pact consumer contract

Run:

```bash
npm run test:contract
```

Consumer:

```text
MarketplaceFrontend
```

Provider:

```text
MarketplaceAPI
```

Provider state:

```text
order 1 exists
```

The interaction verifies:

```text
GET /orders/1
```

Generated Pact:

```text
pacts/MarketplaceFrontend-MarketplaceAPI.json
```

The Pact path `/orders/1` matches the OpenAPI path `/orders/{id}`.

### Pact provider verification

Run locally against the generated Pact:

```bash
npm run verify:provider
```

The verifier starts the real Nest application against a PostgreSQL Testcontainer. `stateHandlers` seed the required user, product, order and order item before Pact executes the interaction.
Successful verification includes:

```text
has a matching body (OK)
```

Provider-state setup uses repeatable `INSERT ... ON CONFLICT` statements.

### Pact Broker

The local Pact Broker is part of `docker-compose.yml` and is exposed on:

```text
http://127.0.0.1:9292
```

Start the stack:

```bash
docker compose up -d --wait
```

Local broker variables:

```bash
export PACT_BROKER_URL=http://127.0.0.1:9292
export PACT_CONSUMER=MarketplaceFrontend
export PACT_PROVIDER=MarketplaceAPI
export PACT_CONSUMER_VERSION=hw16-consumer-1
export PACT_PROVIDER_VERSION=hw16-provider-1
```

Publish the Pact:

```bash
curl -i   -X PUT   "$PACT_BROKER_URL/pacts/provider/$PACT_PROVIDER/consumer/$PACT_CONSUMER/version/$PACT_CONSUMER_VERSION"   -H 'Content-Type: application/json'   --data-binary @pacts/MarketplaceFrontend-MarketplaceAPI.json
```

Expected HTTP status:

```text
201
```

The main local provider-verification path uses the existing secret wrapper:

```bash
bash scripts/with-secrets.sh dev npm run verify:provider
```

For grading, the broker URL can be passed directly because the grader has no access to the secret storage:

```bash
PACT_BROKER_URL=http://127.0.0.1:9292 PACT_PROVIDER_VERSION=hw16-provider-1 npm run verify:provider
```

When a broker URL is present, provider verification uses `publishVerificationResult: true`.

### can-i-deploy gate

Before any provider version is tagged as `prod`, the gate is intentionally unknown.
Relevant response fields before the `prod` tag:

```json
{
  "deployable": null,
  "unknown": 1
}
```

Tag the verified provider version:

```bash
curl -i   -X PUT   "$PACT_BROKER_URL/pacticipants/$PACT_PROVIDER/versions/$PACT_PROVIDER_VERSION/tags/prod"   -H 'Content-Type: application/json'
```

Run the same gate again:

```bash
curl   "$PACT_BROKER_URL/can-i-deploy?pacticipant=$PACT_CONSUMER&version=$PACT_CONSUMER_VERSION&to=prod"
```

Relevant response after the `prod` tag:

```json
{
  "deployable": true
}
```

This `unknown → true` transition proves that the deployment gate is based on a verified provider version.

### Contract CI job

Workflow:

```text
.github/workflows/contract.yml
```

The `contract` job runs:

```text
install → compile → integration → E2E → consumer Pact → publish → verify → can-i-deploy
```

`PACT_BROKER_URL` and `PACT_BROKER_TOKEN` come from GitHub Actions secrets. The token is not stored in the repository.
Jest explicitly uses:

```js
reporters: ['default'];
```

so `PASS` lines and test names are printed consistently.

## Secret wrapper

Database commands are wrapped by:

```text
scripts/with-secrets.sh
```

The normal development path uses the configured secret-storage flow. For CI/grading, `SKIP_VAULT=1` allows already-provided environment variables to be used without access to the developer's vault.
Database-related npm scripts:

```text
migrate
migrate:show
migrate:revert
seed
demo:nplus1
demo:race
demo:workers
demo:retry
report
```

Backup and restore commands use the same wrapper:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

## Grading

Run from a fresh clone with Docker running:

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1
export DB_PORT=6432
export DB_USER=marketplace
export DB_PASSWORD=marketplace_password
export DB_NAME=marketplace
export DATABASE_URL=postgresql://marketplace:marketplace_password@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
npm ci
npx tsc --noEmit
npm run test:integration
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
```

Verify Testcontainers:

```bash
grep -rn "PostgreSqlContainer" test/ src/
```

Verify constraint coverage:

```bash
grep -rniE "duplicate key|unique|2350[0-9]|foreign key|constraint" test/ src/
```

Verify the Jest reporter:

```bash
grep -n "reporters" jest.config.*
```

Expected configuration includes:

```text
reporters: ['default']
```

Verify the E2E negative case:

```bash
grep -rnE "\b(400|404|409|422)\b|HttpStatus\.(BAD_REQUEST|NOT_FOUND|CONFLICT|UNPROCESSABLE_ENTITY)" test/e2e/
```

Verify the generated Pact and provider state:

```bash
ls pacts/*.json
grep providerStates pacts/*.json
```

Verify provider output:

```bash
npm run verify:provider 2>&1   | sed -E $'s/\x1b\\[[0-9;]*m//g'   | grep -F "has a matching body (OK)"
```

Expected:

```text
has a matching body (OK)
```

Verify that the Pact path exists in the OpenAPI specification:

```bash
node -e 'const p=require("./pacts/MarketplaceFrontend-MarketplaceAPI.json");const spec=require("fs").readFileSync("openapi/openapi.yaml","utf8");const sp=[...spec.matchAll(/^\s+(\/\S*):\s*$/gm)].map(m=>m[1]);const seg=s=>s.split("?")[0].replace(/\/+$/,"").split("/");const fit=(a,b)=>{a=seg(a);b=seg(b);return a.length===b.length&&a.every((x,i)=>/^\{[^}]+\}$/.test(x)?b[i]!=="":x===b[i])};const bad=p.interactions.filter(i=>!sp.some(x=>fit(x,i.request.path)));console.log(bad.length?"НЕМАЄ У СПЕЦІ: "+bad.map(i=>i.request.path).join(", "):"OK");process.exit(bad.length?1:0)'
```

Expected:

```text
OK
```

### Local Pact Broker gate

```bash
export PACT_BROKER_URL=http://127.0.0.1:9292
export PACT_CONSUMER=MarketplaceFrontend
export PACT_PROVIDER=MarketplaceAPI
export PACT_CONSUMER_VERSION=hw16-consumer-1
export PACT_PROVIDER_VERSION=hw16-provider-1
```

Publish:

```bash
curl -i   -X PUT   "$PACT_BROKER_URL/pacts/provider/$PACT_PROVIDER/consumer/$PACT_CONSUMER/version/$PACT_CONSUMER_VERSION"   -H 'Content-Type: application/json'   --data-binary @pacts/MarketplaceFrontend-MarketplaceAPI.json
```

Verify provider and publish the result:

```bash
PACT_BROKER_URL="$PACT_BROKER_URL" PACT_PROVIDER_VERSION="$PACT_PROVIDER_VERSION" npm run verify:provider
```

Before tagging the provider as `prod`:

```bash
curl "$PACT_BROKER_URL/can-i-deploy?pacticipant=$PACT_CONSUMER&version=$PACT_CONSUMER_VERSION&to=prod"
```

Relevant response:

```json
{
  "deployable": null,
  "unknown": 1
}
```

Tag the verified provider version:

```bash
curl -i   -X PUT   "$PACT_BROKER_URL/pacticipants/$PACT_PROVIDER/versions/$PACT_PROVIDER_VERSION/tags/prod"   -H 'Content-Type: application/json'
```

Run the same gate again:

```bash
curl "$PACT_BROKER_URL/can-i-deploy?pacticipant=$PACT_CONSUMER&version=$PACT_CONSUMER_VERSION&to=prod"
```

Relevant response:

```json
{
  "deployable": true
}
```

Verify CI:

```bash
grep -rn "can-i-deploy" .github/workflows/
```

Validate YAML when PyYAML is installed:

```bash
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/contract.yml'));print('YAML OK')"
```

Verify the secret wrapper:

```bash
test -f scripts/with-secrets.sh && grep -q 'SKIP_VAULT' scripts/with-secrets.sh
```

Verify that no Pact Broker token value is committed:

```bash
grep -rnE "PACT_BROKER_TOKEN[[:space:]]*[:=][[:space:]]*['\"][^'\"$]"   --include='*.ts'   --include='*.js'   --include='*.yml'   --include='*.yaml'   --include='*.json'   . | grep -v node_modules
```

Expected: no output.

## Main project structure

```text
src/
├── entities/
├── migrations/
├── orders/
├── repositories/
├── checkout.ts
├── data-source.ts
├── database.service.ts
├── seed.ts
├── demo-nplus1.ts
├── demo-race.ts
├── demo-workers.ts
├── demo-retry.ts
└── report.ts
test/
├── integration/
│   ├── testkit/
│   ├── product.repository.spec.ts
│   └── user.repository.spec.ts
├── e2e/
│   └── orders.e2e.spec.ts
└── contract/
    ├── consumer/
    └── provider/
pacts/
└── MarketplaceFrontend-MarketplaceAPI.json
.github/
└── workflows/
    └── contract.yml
pgbouncer/
├── pgbouncer.ini
└── userlist.txt
scripts/
├── with-secrets.sh
├── backup.sh
└── restore-drill.sh
backup.cron
RESTORE-DRILL.md
db/
├── schema.sql
├── seed.sql
├── indexes.sql
├── OPTIMIZATIONS.md
└── queries/
```

## Submission

Submit the Pull Request from the `hw-16` branch.
