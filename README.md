# Marketplace API

Course project for Node.js.

The project evolves through several homework stages:

- HW09 — OpenAPI contract and runtime validation
- HW11 — typed configuration, secrets and PostgreSQL connection
- HW12 — PostgreSQL schema, realistic seed data, query optimization and full-text search

---

# Homework 09 — OpenAPI Validation

HW09 uses **Option B — runtime validation** with:

- Express 4
- OpenAPI 3.0.3
- Redocly CLI

The OpenAPI specification is the source of truth for requests and responses.

## OpenAPI validation

Validate the API specification:

```bash
npx @redocly/cli lint openapi/openapi.yaml
```

Bundle the specification:

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
```

Check cursor pagination:

```bash
grep -c 'next_cursor' openapi/openapi.yaml
```

Check problem+json responses:

```bash
grep -c 'application/problem+json' openapi/openapi.yaml
```

## API resources

The API contains two main resources:

- `/products`
- `/orders`

Implemented operations:

- `GET /products`
- `GET /products/{id}`
- `GET /orders`
- `GET /orders/{id}`
- `POST /orders`

---

# Homework 11 — Configuration and Secrets

HW11 adds:

- typed environment configuration with Zod
- fail-fast startup validation
- `.env.example` synchronization check
- secrets outside git and Docker image
- PostgreSQL via Docker Compose
- database password from a secret file
- database password rotation without application restart

---

# Configuration

## Environment variables

All application environment variables are described in:

```text
src/config/env.schema.ts
```

Current variables:

| Variable           | Required | Default               | Description                                 | Source                            |
| ------------------ | -------- | --------------------- | ------------------------------------------- | --------------------------------- |
| `PORT`             | No       | `3000`                | HTTP port used by the application           | environment                       |
| `DB_URL`           | Yes      | —                     | PostgreSQL connection URL without password  | secret storage / HW11 environment |
| `DB_PASSWORD_FILE` | No       | `secrets/db_password` | Path to the PostgreSQL password secret file | environment                       |

Example `.env.example`:

```env
PORT=3000
DB_URL=postgresql://marketplace@localhost:5432/marketplace
DB_PASSWORD_FILE=secrets/db_password
```

The real `.env` is ignored by git.

The application database connection continues to use the same secret-storage setup introduced in HW11. HW12 does not introduce a new tracked environment file.

The PostgreSQL credentials stored in `docker-compose.yml` are local development credentials used to start the database from a fresh clone. They are separate from the application's secret-storage flow.

## Environment example contract

`.env.example` is committed to git and must stay synchronized with the Zod environment schema.

Run:

```bash
npm run check:env
```

Expected result:

```text
.env.example is synchronized with env schema.
```

If a variable is missing or extra, the command exits with code `1`.

## Fail-fast validation

Configuration is validated during application startup through `ConfigModule.forRoot`.

If a required variable is missing or invalid, the application must not start.

Example:

```bash
mv .env /tmp/.env
env -u DB_URL npm run start
echo $?
```

Expected output contains:

```text
Environment validation failed:
DB_URL
```

The exit code must be non-zero.

Restore the file:

```bash
mv /tmp/.env .
```

## Database secret

The PostgreSQL password used by the application is not stored in `.env`.

It is stored in:

```text
secrets/db_password
```

Create the local secret file:

```bash
mkdir -p secrets
printf 'marketplace_password' > secrets/db_password
```

The `secrets/` directory is ignored by git and excluded from the Docker image.

---

# Install

Install dependencies:

```bash
npm install
```

---

# PostgreSQL

## Start the database

From a fresh clone, start PostgreSQL with:

```bash
docker compose up -d --wait
```

## Connect to the database

Connect with:

```bash
docker compose exec postgres psql -U marketplace -d marketplace
```

These commands work without editing repository files.

Check the container:

```bash
docker compose ps
```

---

# Start the application

Start the application:

```bash
npm start
```

The application runs on:

```text
http://localhost:3000
```

Development mode:

```bash
npm run start:dev
```

---

# Health check

```bash
curl http://localhost:3000/health
```

Example response:

```json
{
  "status": "ok",
  "uptime": 30
}
```

---

# Database check

```bash
curl http://localhost:3000/db-check
```

Expected response:

```json
{
  "status": "ok",
  "database": "database is working"
}
```

The database pool reads the password from `secrets/db_password` when a new PostgreSQL connection is created.

---

# Database Password Rotation

The database password can be rotated without restarting the application.

The rotation script:

1. changes the PostgreSQL role password with `ALTER ROLE`
2. updates `secrets/db_password`
3. terminates old PostgreSQL connections
4. lets the application pool open a new connection
5. reads the new password from the secret file

Run:

```bash
bash rotate.sh
```

The script generates a new password on every run.

## Verify rotation without restart

Start the application and do not restart it during this test.

Check uptime:

```bash
curl http://localhost:3000/health
```

Check the database:

```bash
curl http://localhost:3000/db-check
```

Rotate the password:

```bash
bash rotate.sh
```

Check the secret:

```bash
cat secrets/db_password
```

Check the database again:

```bash
curl http://localhost:3000/db-check
```

Expected result:

```json
{
  "status": "ok",
  "database": "database is working"
}
```

Check uptime again:

```bash
curl http://localhost:3000/health
```

The new uptime must be greater than the previous value.

This confirms that the application process was not restarted.

## Reset PostgreSQL password after recreating the volume

If PostgreSQL is recreated with:

```bash
docker compose down -v
docker compose up -d --wait
```

the database returns to its initial password.

Reset the local application secret:

```bash
printf 'marketplace_password' > secrets/db_password
```

Otherwise the application can fail with a PostgreSQL authentication error.

---

# Docker Security Checks

Build the image:

```bash
docker build -t myapp .
```

Check image contents:

```bash
docker run --rm myapp ls -a /app
```

`.env.example` should exist.

`.env` and `secrets/` must not exist.

Check `.env` directly:

```bash
docker run --rm myapp sh -c 'cat /app/.env' 2>&1
```

Expected result:

```text
No such file or directory
```

Check image environment:

```bash
docker inspect --format '{{.Config.Env}}' myapp
```

There must be no database passwords or project secrets.

Check image history:

```bash
docker history --no-trunc myapp | grep -i password
```

Expected result: no output.

---

# Homework 12 — PostgreSQL Data Layer and Optimization

HW12 adds the PostgreSQL data layer for the Marketplace API:

- relational schema
- foreign keys and constraints
- realistic seed data
- at least 100,000 rows in the main workload table
- at least 100,000 rows in the full-text search table
- query analysis with `EXPLAIN (ANALYZE, BUFFERS)`
- B-tree indexes
- partial index
- expression index
- GIN index over `tsvector`
- PostgreSQL full-text catalog search
- Ukrainian morphology analysis

The main table used for the workload is:

```text
orders
```

The full-text search table is:

```text
products
```

---

# HW12 Database Files

```text
db/
├── schema.sql
├── seed.sql
├── indexes.sql
├── OPTIMIZATIONS.md
└── queries/
    ├── q1.sql
    ├── q2.sql
    ├── q3.sql
    └── q4.sql
```

---

# HW12 Clean Database Setup

Use the same order as the grader.

## 1. Reset the database

```bash
docker compose down -v
docker compose up -d --wait
```

## 2. Apply the schema

```bash
cat db/schema.sql | docker compose exec -T postgres psql -U marketplace -d marketplace
```

The schema creates:

```text
users
products
orders
order_items
```

The schema includes:

- foreign keys
- `NOT NULL`
- `CHECK`
- `NUMERIC` fields for money
- `TIMESTAMPTZ` fields for timestamps
- generated `products.search_vector` column

Check foreign keys:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';"
```

Expected result:

```text
4
```

## 3. Seed the database

```bash
cat db/seed.sql | docker compose exec -T postgres psql -U marketplace -d marketplace
```

The seed creates:

```text
users:       100000
products:    120000
orders:      150000
order_items: 150000
```

The main workload table is:

```text
orders
```

The full-text search table is:

```text
products
```

Check row counts:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -c "SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM products) AS products,
        (SELECT count(*) FROM orders) AS orders,
        (SELECT count(*) FROM order_items) AS order_items;"
```

Expected result:

```text
users       100000
products    120000
orders      150000
order_items 150000
```

The seed ends with:

```sql
VACUUM (ANALYZE);
```

This updates planner statistics and the visibility map before query analysis.

---

# HW12 Queries

## Q1 — Orders by user and date range

File:

```text
db/queries/q1.sql
```

The query retrieves recent orders for a specific user.

The optimization uses:

```text
idx_orders_user_created_at
```

## Q2 — Cancelled orders

File:

```text
db/queries/q2.sql
```

The query retrieves cancelled orders.

The optimization uses the partial index:

```text
idx_orders_cancelled_created_at
```

## Q3 — Case-insensitive email lookup

File:

```text
db/queries/q3.sql
```

The query performs a case-insensitive email lookup.

The optimization uses the expression index:

```text
idx_users_lower_email
```

## Q4 — Full-text product search

File:

```text
db/queries/q4.sql
```

The query performs PostgreSQL full-text search over product names and descriptions.

The optimization uses:

```text
idx_products_search_vector
```

This is a GIN index over the generated `tsvector` column.

---

# EXPLAIN Before Indexes

Before applying `db/indexes.sql`, every query must use `Seq Scan` or `Parallel Seq Scan`.

Run Q1:

```bash
docker compose exec -e PAGER=cat postgres \
  psql -U marketplace -d marketplace \
  -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"
```

Run Q2:

```bash
docker compose exec -e PAGER=cat postgres \
  psql -U marketplace -d marketplace \
  -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q2.sql)"
```

Run Q3:

```bash
docker compose exec -e PAGER=cat postgres \
  psql -U marketplace -d marketplace \
  -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q3.sql)"
```

Run Q4:

```bash
docker compose exec -e PAGER=cat postgres \
  psql -U marketplace -d marketplace \
  -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q4.sql)"
```

Before indexes, all four execution plans must contain:

```text
Seq Scan
```

or:

```text
Parallel Seq Scan
```

The complete plans are documented in:

```text
db/OPTIMIZATIONS.md
```

---

# Apply HW12 Indexes

Apply the optimization indexes:

```bash
cat db/indexes.sql | docker compose exec -T postgres psql -U marketplace -d marketplace
```

Refresh planner statistics:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -c "ANALYZE;"
```

The custom indexes are:

```text
idx_orders_user_created_at
idx_orders_cancelled_created_at
idx_users_lower_email
idx_products_search_vector
```

---

# EXPLAIN After Indexes

Run the same four queries again.

After optimization:

- Q1 uses `idx_orders_user_created_at`
- Q2 uses `idx_orders_cancelled_created_at`
- Q3 uses `idx_users_lower_email`
- Q4 uses `idx_products_search_vector`
- none of the four plans uses `Seq Scan`

For Q4, run the EXPLAIN several times after creating the GIN index and use a warmed result for comparison.

The complete before/after plans are documented in:

```text
db/OPTIMIZATIONS.md
```

---

# HW12 Index Verification

## Check unused custom indexes

After all four optimized queries have been executed with `EXPLAIN (ANALYZE, BUFFERS)`:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT indexrelname FROM pg_stat_user_indexes WHERE schemaname='public' AND idx_scan = 0 AND indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conindid <> 0);"
```

Expected result:

```text
no output
```

## Check partial or expression index

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef NOT ILIKE '%USING gin%' AND (indexdef ILIKE '% WHERE %' OR indexdef ~ '\((\w+)\(');"
```

Current result:

```text
2
```

## Check GIN index over tsvector

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam JOIN pg_opclass o ON o.oid=i.indclass[0] WHERE am.amname='gin' AND o.opcintype='tsvector'::regtype;"
```

Expected result:

```text
1
```

---

# Ukrainian Full-Text Search Morphology

The product catalog contains Ukrainian names and descriptions.

The full-text search configuration is:

```text
simple
```

Base form search:

```sql
SELECT count(*)
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');
```

Result:

```text
2400
```

Another grammatical form:

```sql
SELECT count(*)
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'кросівок');
```

Result:

```text
0
```

The `simple` text search configuration does not perform Ukrainian stemming or morphological normalization, so `кросівки` and `кросівок` are treated as different lexemes.

The available PostgreSQL text search configurations can be inspected with:

```sql
\dF
```

The current PostgreSQL installation does not contain a dedicated Ukrainian text search configuration.

Switching to another unrelated built-in configuration such as `russian` would not correctly solve Ukrainian morphology.

Detailed measurements are documented in:

```text
db/OPTIMIZATIONS.md
```

---

# HW12 Optimization Report

The optimization report is stored in:

```text
db/OPTIMIZATIONS.md
```

It contains:

- Q1 before and after indexes
- Q2 before and after indexes
- Q3 before and after indexes
- Q4 before and after indexes
- execution times
- buffer usage
- index names used by PostgreSQL
- explanation of plan changes
- Ukrainian morphology results

Check that the report contains at least eight execution measurements:

```bash
grep -c 'Execution Time' db/OPTIMIZATIONS.md
```

Expected result:

```text
8
```

---

# HW12 Acceptance Checks

## Schema applies from scratch

```bash
cat db/schema.sql | docker compose exec -T postgres psql -U marketplace -d marketplace
```

Expected: no errors.

Check foreign keys:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';"
```

Expected:

```text
4
```

## Seed volume

Check main table:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT count(*) FROM orders;"
```

Expected:

```text
150000
```

Check search table:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT count(*) FROM products;"
```

Expected:

```text
120000
```

## Report completeness

```bash
grep -c 'Execution Time' db/OPTIMIZATIONS.md
```

Expected:

```text
8
```

## Morphology section

```bash
sed -n '/[Мм]орфолог/,/^#/p' db/OPTIMIZATIONS.md | grep -oE '[0-9]+' | wc -l
```

Expected:

```text
2 or more
```

## Environment files

Check that no tracked non-example environment file contains the database connection variable:

```bash
for f in $(git ls-files | grep -E '\.env($|\.)' | grep -vE '\.example$'); do grep -lE '^(DATABASE_URL|DB_URL)=' "$f"; done
```

Expected result:

```text
no output
```

Check that `.env.example` contains the connection variable:

```bash
grep -cE '^(DATABASE_URL|DB_URL)=' .env.example
```

Expected result:

```text
1
```

## Fresh clone database startup

A fresh clone must be able to start PostgreSQL without manual file edits.

Start the database:

```bash
docker compose up -d --wait
```

Connect:

```bash
docker compose exec postgres psql -U marketplace -d marketplace
```

Verify connectivity:

```bash
docker compose exec postgres \
  psql -U marketplace -d marketplace \
  -Atc "SELECT 1;"
```

Expected:

```text
1
```

---

# Submission

Submit a Pull Request from the HW12 branch.

The grader must be able to reproduce the database setup on a clean volume without modifying repository files.
