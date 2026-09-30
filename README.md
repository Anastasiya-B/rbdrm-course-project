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

Start PostgreSQL:

```bash
docker compose up -d --wait
```

Development database credentials are defined in `docker-compose.yml`:

```text
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=marketplace
DB_PASSWORD=marketplace_password
DB_NAME=marketplace
```

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
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM products) AS products,
  (SELECT count(*) FROM orders) AS orders,
  (SELECT count(*) FROM order_items) AS order_items;"
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
grep -rniE "\.(add)?groupBy\(" src/
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
  AND stock_quantity >= $1
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

## Grading

Run from a fresh clone:

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=marketplace DB_PASSWORD=marketplace_password DB_NAME=marketplace
export SKIP_VAULT=1
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed
npm run seed
npm run demo:nplus1
npm run report
npm run demo:race
npm run demo:workers
npm run demo:retry
```

Check that synchronization is not enabled:

```bash
grep -rn "synchronize: true" src/
```

Expected: no output.

Check relation deletion strategies:

```bash
grep -rn "onDelete" src/
```

Expected: both `CASCADE` and `RESTRICT`.

Check QueryBuilder grouping:

```bash
grep -rniE "\.(add)?groupBy\(" src/
```

Check atomic checkout protection:

```bash
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "for update|returning|pessimistic_write" .
```

Check `SKIP LOCKED` usage:

```bash
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "skip[ \_]locked" .
```

Check retryable database error codes:

```bash
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "40001|40P01" .
```

Check that HW14 demos use the secret wrapper:

```bash
node -e "const s=require('./package.json').scripts;const bad=['demo:race','demo:workers','demo:retry'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'without wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Expected:

```text
OK
```

Check that `migrate` and `seed` use the secret wrapper:

```bash
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'without wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Expected:

```text
OK
```

Check that the DataSource contains no hardcoded password:

```bash
grep -nE "password:[[:space:]]*['\"]" src/data-source.ts
```

Expected: no output.

## Main project structure

```text
src/
├── entities/
├── migrations/
├── checkout.ts
├── data-source.ts
├── seed.ts
├── demo-nplus1.ts
├── demo-race.ts
├── demo-workers.ts
├── demo-retry.ts
└── report.ts
scripts/
└── with-secrets.sh
db/
├── schema.sql
├── seed.sql
├── indexes.sql
├── OPTIMIZATIONS.md
└── queries/
```

## Submission

Submit the Pull Request from the `hw-14` branch.
