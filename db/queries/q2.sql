SELECT
  id,
  user_id,
  status,
  total_amount,
  created_at
FROM orders
WHERE status = 'cancelled'
ORDER BY created_at DESC