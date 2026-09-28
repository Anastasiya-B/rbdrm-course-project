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
Sort  (cost=4113.82..4113.82 rows=1 width=40) (actual time=11.366..13.745 rows=2 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1352
  ->  Gather  (cost=1000.00..4113.81 rows=1 width=40) (actual time=1.925..13.721 rows=2 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=1349
        ->  Parallel Seq Scan on orders  (cost=0.00..3113.71 rows=1 width=40) (actual time=2.344..6.969 rows=1 loops=2)
              Filter: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
              Rows Removed by Filter: 74999
              Buffers: shared hit=1349
Planning:
  Buffers: shared hit=97
Planning Time: 1.190 ms
Execution Time: 13.797 ms
```

Before optimization PostgreSQL performed a `Parallel Seq Scan` over the `orders` table and filtered almost all rows.

### After index

```text
Index Scan using idx_orders_user_created_at on orders  (cost=0.42..8.45 rows=1 width=40) (actual time=0.042..0.044 rows=2 loops=1)
  Index Cond: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
  Buffers: shared hit=5 read=3
Planning:
  Buffers: shared hit=120 read=1
Planning Time: 0.533 ms
Execution Time: 0.068 ms
```

The `idx_orders_user_created_at` index replaced the parallel sequential scan with an `Index Scan`. Execution time decreased from 13.797 ms to 0.068 ms and the execution phase touched only a few shared buffers.

## Q2 — Order items by order

The query retrieves all items belonging to a specific order.

### Before index

```text
Sort  (cost=3277.01..3277.02 rows=1 width=44) (actual time=11.134..11.136 rows=1 loops=1)
  Sort Key: id
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1405
  ->  Seq Scan on order_items  (cost=0.00..3277.00 rows=1 width=44) (actual time=0.222..11.116 rows=1 loops=1)
        Filter: (order_id = 12345)
        Rows Removed by Filter: 149999
        Buffers: shared hit=1402
Planning:
  Buffers: shared hit=83
Planning Time: 0.324 ms
Execution Time: 11.256 ms
```

Before optimization PostgreSQL scanned all 150,000 rows in `order_items` and removed 149,999 rows that belonged to other orders.

### After index

```text
Sort  (cost=8.45..8.45 rows=1 width=44) (actual time=0.047..0.048 rows=1 loops=1)
  Sort Key: id
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=7 read=3
  ->  Index Scan using idx_order_items_order_id on order_items  (cost=0.42..8.44 rows=1 width=44) (actual time=0.035..0.036 rows=1 loops=1)
        Index Cond: (order_id = 12345)
        Buffers: shared hit=4 read=3
Planning:
  Buffers: shared hit=94 read=1
Planning Time: 0.262 ms
Execution Time: 0.141 ms
```

The `idx_order_items_order_id` index replaced the `Seq Scan` with an `Index Scan`. Execution time decreased from 11.256 ms to 0.141 ms, while execution buffers dropped from 1405 to 10. The same index also supports lookups by the `order_id` foreign key used by the `ON DELETE CASCADE` relationship.

## Q3 — Case-insensitive email lookup

The query searches for a user by email without case sensitivity.

### Before index

```text
Seq Scan on users  (cost=0.00..2725.00 rows=500 width=63) (actual time=44.277..80.736 rows=1 loops=1)
  Filter: (lower(email) = 'user54321@example.com'::text)
  Rows Removed by Filter: 99999
  Buffers: shared hit=1225
Planning:
  Buffers: shared hit=87
Planning Time: 0.373 ms
Execution Time: 80.759 ms
```

Because the query applies `lower()` to the email column, the normal unique B-tree index on `email` cannot directly satisfy the expression, so PostgreSQL performed a `Seq Scan`.

### After index

```text
Index Scan using idx_users_lower_email on users  (cost=0.42..8.44 rows=1 width=63) (actual time=0.036..0.037 rows=1 loops=1)
  Index Cond: (lower(email) = 'user54321@example.com'::text)
  Buffers: shared hit=1 read=3
Planning:
  Buffers: shared hit=106 read=1
Planning Time: 0.367 ms
Execution Time: 0.055 ms
```

The expression index `idx_users_lower_email` allows PostgreSQL to use an `Index Scan` directly on `lower(email)`. Execution time decreased from 80.759 ms to 0.055 ms and only four execution buffers were accessed.

## Q4 — Full-text catalog search

The query searches product names and descriptions using PostgreSQL full-text search.

### Before index

```text
Limit  (cost=6351.31..6351.36 rows=20 width=32) (actual time=34.294..34.298 rows=20 loops=1)
  Buffers: shared hit=4856
  ->  Sort  (cost=6351.31..6351.42 rows=45 width=32) (actual time=34.293..34.295 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=4856
        ->  Seq Scan on products  (cost=0.00..6350.11 rows=45 width=32) (actual time=2.496..33.630 rows=2400 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 117600
              Buffers: shared hit=4850
Planning:
  Buffers: shared hit=96
Planning Time: 1.601 ms
Execution Time: 34.322 ms
```

Before the GIN index PostgreSQL scanned all 120,000 products and filtered 117,600 rows.

### After index

```text
Limit  (cost=206.37..206.42 rows=20 width=32) (actual time=9.161..9.166 rows=20 loops=1)
  Buffers: shared hit=2413
  ->  Sort  (cost=206.37..206.49 rows=47 width=32) (actual time=9.160..9.162 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=2413
        ->  Bitmap Heap Scan on products  (cost=30.29..205.12 rows=47 width=32) (actual time=3.170..8.632 rows=2400 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=2398
              Buffers: shared hit=2407
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.28 rows=47 width=0) (actual time=2.818..2.818 rows=2400 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=9
Planning:
  Buffers: shared hit=119 read=1
Planning Time: 0.645 ms
Execution Time: 9.242 ms
```

The GIN index `idx_products_search_vector` replaced the sequential scan with a `Bitmap Index Scan` and `Bitmap Heap Scan`. Execution time decreased from 34.322 ms to 9.242 ms and shared buffer usage dropped substantially.

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

The `simple` text search configuration does not perform Ukrainian stemming or morphological normalization, so `кросівки` and `кросівок` are treated as different lexemes. The PostgreSQL text search configuration list does not contain a dedicated Ukrainian configuration, so switching to another built-in language configuration would not correctly solve Ukrainian morphology.

## Indexes

The optimization uses the following indexes:

```sql
CREATE INDEX idx_orders_user_created_at
ON orders (user_id, created_at DESC);

CREATE INDEX idx_order_items_order_id
ON order_items (order_id);

CREATE INDEX idx_users_lower_email
ON users (lower(email));

CREATE INDEX idx_products_search_vector
ON products USING GIN (search_vector);
```

Each custom index is used by one of the four measured queries.

The expression index `idx_users_lower_email` satisfies case-insensitive email lookup without applying a sequential scan.

The `idx_order_items_order_id` index supports both the Q2 lookup and the foreign-key relationship from `order_items.order_id` to `orders.id`.

The `idx_products_search_vector` index uses GIN over the stored `tsvector` generated from the product name and description.
