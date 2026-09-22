# PostgreSQL Query Optimizations

This document contains query execution plans before and after adding indexes.

The database contains:

- 100,000 users
- 120,000 products
- 150,000 orders
- 150,000 order items

All measurements were collected using:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

## Q1 — Orders by user and date range

The query retrieves recent orders for a specific user.

### Before index

```text
Sort  (cost=4113.82..4113.82 rows=1 width=40) (actual time=9.301..11.292 rows=2 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1352
  ->  Gather  (cost=1000.00..4113.81 rows=1 width=40) (actual time=0.307..11.271 rows=2 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=1349
        ->  Parallel Seq Scan on orders  (cost=0.00..3113.71 rows=1 width=40) (actual time=1.464..7.224 rows=1 loops=2)
              Filter: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
              Rows Removed by Filter: 74999
              Buffers: shared hit=1349
Planning:
  Buffers: shared hit=97
Planning Time: 0.362 ms
Execution Time: 11.329 ms
```

Before optimization PostgreSQL performed a `Parallel Seq Scan` over the `orders` table and filtered almost all rows.

### After index

```text
Index Scan using idx_orders_user_created_at on orders  (cost=0.42..8.45 rows=1 width=40) (actual time=0.033..0.035 rows=2 loops=1)
  Index Cond: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
  Buffers: shared hit=8
Planning:
  Buffers: shared hit=136
Planning Time: 0.559 ms
Execution Time: 0.073 ms
```

The `idx_orders_user_created_at` index replaced the sequential scan with an `Index Scan`. Shared buffers dropped from 1352 to 8 and execution time decreased from 11.329 ms to 0.073 ms.

## Q2 — Cancelled orders

The query retrieves cancelled orders sorted by creation date.

### Before index

```text
Sort  (cost=3694.93..3713.27 rows=7335 width=40) (actual time=17.217..17.701 rows=7500 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 720kB
  Buffers: shared hit=1352
  ->  Seq Scan on orders  (cost=0.00..3224.00 rows=7335 width=40) (actual time=0.014..15.532 rows=7500 loops=1)
        Filter: (status = 'cancelled'::text)
        Rows Removed by Filter: 142500
        Buffers: shared hit=1349
Planning:
  Buffers: shared hit=92
Planning Time: 0.403 ms
Execution Time: 18.140 ms
```

Before optimization PostgreSQL scanned all 150,000 orders and removed 142,500 rows that did not match the requested status.

### After index

```text
Sort  (cost=1992.19..2010.58 rows=7355 width=40) (actual time=4.599..5.019 rows=7500 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 720kB
  Buffers: shared hit=1361
  ->  Bitmap Heap Scan on orders  (cost=78.90..1519.83 rows=7355 width=40) (actual time=0.657..3.030 rows=7500 loops=1)
        Recheck Cond: (status = 'cancelled'::text)
        Heap Blocks: exact=1349
        Buffers: shared hit=1358
        ->  Bitmap Index Scan on idx_orders_cancelled_created_at  (cost=0.00..77.06 rows=7355 width=0) (actual time=0.497..0.497 rows=7500 loops=1)
              Buffers: shared hit=9
Planning:
  Buffers: shared hit=125
Planning Time: 0.379 ms
Execution Time: 5.433 ms
```

The partial `idx_orders_cancelled_created_at` index is used through a `Bitmap Index Scan`, removing the `Seq Scan`. Execution time decreased from 18.140 ms to 5.433 ms.

## Q3 — Case-insensitive email lookup

The query searches for a user by email without case sensitivity.

### Before index

```text
Seq Scan on users  (cost=0.00..2725.00 rows=500 width=63) (actual time=39.545..74.410 rows=1 loops=1)
  Filter: (lower(email) = 'user54321@example.com'::text)
  Rows Removed by Filter: 99999
  Buffers: shared hit=1225
Planning:
  Buffers: shared hit=87
Planning Time: 0.319 ms
Execution Time: 74.434 ms
```

Because the query applies `lower()` to the email column, the normal unique B-tree index on `email` cannot directly satisfy the expression, so PostgreSQL performed a `Seq Scan`.

### After index

```text
Index Scan using idx_users_lower_email on users  (cost=0.42..8.44 rows=1 width=63) (actual time=0.023..0.024 rows=1 loops=1)
  Index Cond: (lower(email) = 'user54321@example.com'::text)
  Buffers: shared hit=4
Planning:
  Buffers: shared hit=107
Planning Time: 0.495 ms
Execution Time: 0.050 ms
```

The expression index `idx_users_lower_email` allows PostgreSQL to use `Index Scan` directly on `lower(email)`. Shared buffers dropped from 1225 to 4 and execution time decreased from 74.434 ms to 0.050 ms.

## Q4 — Full-text catalog search

The query searches product names and descriptions using PostgreSQL full-text search.

### Before index

```text
Limit  (cost=6351.54..6351.59 rows=20 width=33) (actual time=28.803..28.807 rows=20 loops=1)
  Buffers: shared hit=4856
  ->  Sort  (cost=6351.54..6351.68 rows=53 width=33) (actual time=28.802..28.804 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=4856
        ->  Seq Scan on products  (cost=0.00..6350.13 rows=53 width=33) (actual time=0.024..28.135 rows=2400 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 117600
              Buffers: shared hit=4850
Planning:
  Buffers: shared hit=96
Planning Time: 0.464 ms
Execution Time: 28.832 ms
```

Before the GIN index PostgreSQL scanned all 120,000 products and filtered 117,600 rows.

### After index

```text
Limit  (cost=199.15..199.20 rows=20 width=32) (actual time=8.466..8.471 rows=20 loops=1)
  Buffers: shared hit=2413
  ->  Sort  (cost=199.15..199.27 rows=45 width=32) (actual time=8.465..8.467 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=2413
        ->  Bitmap Heap Scan on products  (cost=30.29..197.96 rows=45 width=32) (actual time=1.391..7.674 rows=2400 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=2398
              Buffers: shared hit=2407
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.28 rows=45 width=0) (actual time=1.022..1.022 rows=2400 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=9
Planning:
  Buffers: shared hit=121
Planning Time: 0.887 ms
Execution Time: 8.575 ms
```

The GIN index `idx_products_search_vector` replaced the sequential scan with a `Bitmap Index Scan` and `Bitmap Heap Scan`. Execution time decreased from 28.832 ms to 8.575 ms and shared buffer usage dropped significantly.

## Морфологія

Full-text search was tested using two forms of the same Ukrainian word.

```sql
SELECT count(*)
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');
```

Result:

```text
2400
```

The same search using another grammatical form:

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

## Indexes

The optimization uses the following indexes:

```sql
CREATE INDEX idx_orders_user_created_at
ON orders (user_id, created_at DESC);

CREATE INDEX idx_orders_cancelled_created_at
ON orders (created_at DESC)
WHERE status = 'cancelled';

CREATE INDEX idx_users_lower_email
ON users (lower(email));

CREATE INDEX idx_products_search_vector
ON products USING GIN (search_vector);
```

Each index is used by at least one of the measured queries.

The partial index `idx_orders_cancelled_created_at` and expression index `idx_users_lower_email` demonstrate indexes for query-specific conditions and expressions.

The `idx_products_search_vector` index uses GIN over a stored `tsvector` generated from the product name and description.
