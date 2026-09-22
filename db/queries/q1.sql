SELECT
  id,
  user_id,
  status,
  total_amount,
  created_at
FROM orders
WHERE user_id = 42
  AND created_at >= NOW() - INTERVAL '90 days'
ORDER BY created_at DESC