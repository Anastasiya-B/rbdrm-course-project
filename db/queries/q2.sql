SELECT
  id,
  order_id,
  product_id,
  quantity,
  unit_price,
  created_at
FROM order_items
WHERE order_id = 12345
ORDER BY id