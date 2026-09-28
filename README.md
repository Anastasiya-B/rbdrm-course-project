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
└── order-item.entity.ts
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

Deletion behavior:

- `Order -> OrderItem` uses `CASCADE` because order items belong to an order and should be removed with it.
- user/product parent relations use `RESTRICT` to protect referenced historical data.

## Migrations

TypeORM schema synchronization is disabled:

```ts
synchronize: false;
```

The schema is created and changed only through migrations.

```bash
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
```

The initial migration creates:

- `users`
- `products`
- `orders`
- `order_items`
- foreign keys and checks
- `idx_orders_user_created_at`
- `idx_order_items_order_id`
- `idx_users_lower_email`
- `idx_products_search_vector`

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
├── data-source.ts
├── seed.ts
├── demo-nplus1.ts
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

Submit the Pull Request from the `hw-13` branch.
