SELECT
  id,
  email,
  full_name,
  created_at
FROM users
WHERE lower(email) = lower('user54321@example.com')