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

Run from a fresh clone:

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

bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Verify PgBouncer:

```bash
PGPASSWORD=marketplace_password psql   -h 127.0.0.1   -p 6432   -U marketplace   -d marketplace   -c "SELECT 1;"
```

Check transaction pooling:

```bash
grep -E '^\s*pool_mode\s*=\s*transaction' pgbouncer/pgbouncer.ini
```

Check PgBouncer admin pools:

```bash
PGPASSWORD=marketplace_password psql   -h 127.0.0.1   -p 6432   -U marketplace   -d pgbouncer   -c "SHOW POOLS;"
```

Check the connection contract:

```bash
grep -E '^(export[[:space:]]+)?(DATABASE_URL|DB_URL)=' .env.example
```

The host/port must point to PgBouncer on port `6432`.

Check the backup schedule:

```bash
grep -cE '^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|([0-9*/,-]+[[:space:]]+){4}[0-9*/,-]+)[[:space:]]+.*backup' backup.cron
```

Expected: `1` or more.

Check RTO/RPO documentation:

```bash
grep -iE 'RTO|RPO' RESTORE-DRILL.md
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

Submit the Pull Request from the `hw-15` branch to `main`.
