INSERT INTO users (
  email,
  full_name,
  created_at
)
SELECT
  'user' || gs || '@example.com',
  'Користувач ' || gs,
  NOW() - (gs % 730) * INTERVAL '1 day'
FROM generate_series(1, 100000) AS gs;

INSERT INTO products (
  owner_id,
  name,
  description,
  price,
  stock_quantity,
  is_active,
  created_at
)
SELECT
  ((gs - 1) % 100000) + 1,
  CASE
    WHEN gs % 50 = 0 THEN
      'Шкіряні кросівки ' || gs
    WHEN gs % 37 = 0 THEN
      'Міська сумка ' || gs
    WHEN gs % 29 = 0 THEN
      'Ігровий ноутбук ' || gs
    WHEN gs % 23 = 0 THEN
      'Бездротові навушники ' || gs
    WHEN gs % 19 = 0 THEN
      'Механічна клавіатура ' || gs
    ELSE
      'Товар ' || gs
  END,
  CASE
    WHEN gs % 50 = 0 THEN
      'Зручні шкіряні кросівки для щоденних прогулянок містом'
    WHEN gs % 37 = 0 THEN
      'Практична міська сумка для роботи, подорожей та щоденного використання'
    WHEN gs % 29 = 0 THEN
      'Потужний ігровий ноутбук для роботи, навчання та сучасних ігор'
    WHEN gs % 23 = 0 THEN
      'Бездротові навушники з якісним звуком та тривалим часом роботи'
    WHEN gs % 19 = 0 THEN
      'Механічна клавіатура для роботи та ігор з надійними перемикачами'
    ELSE
      'Якісний товар для щоденного використання'
  END,
  ROUND(
    (
      100 +
      (gs % 50000) +
      (random() * 1000)
    )::numeric,
    2
  ),
  (gs % 100)::integer,
  CASE
    WHEN gs % 20 = 0 THEN FALSE
    ELSE TRUE
  END,
  NOW() - (gs % 1095) * INTERVAL '1 day'
FROM generate_series(1, 120000) AS gs;

INSERT INTO orders (
  user_id,
  status,
  total_amount,
  created_at
)
SELECT
  ((gs - 1) % 100000) + 1,
  CASE
    WHEN gs % 100 < 45 THEN 'completed'
    WHEN gs % 100 < 70 THEN 'paid'
    WHEN gs % 100 < 85 THEN 'shipped'
    WHEN gs % 100 < 95 THEN 'created'
    ELSE 'cancelled'
  END,
  ROUND(
    (
      500 +
      (gs % 20000) +
      (random() * 5000)
    )::numeric,
    2
  ),
  NOW() - (gs % 730) * INTERVAL '1 day'
FROM generate_series(1, 150000) AS gs;

INSERT INTO order_items (
  order_id,
  product_id,
  quantity,
  unit_price,
  created_at
)
SELECT
  gs,
  ((gs * 17 - 1) % 120000) + 1,
  ((gs % 3) + 1)::integer,
  p.price,
  o.created_at
FROM generate_series(1, 150000) AS gs
JOIN orders o
  ON o.id = gs
JOIN products p
  ON p.id = ((gs * 17 - 1) % 120000) + 1;

VACUUM (ANALYZE);