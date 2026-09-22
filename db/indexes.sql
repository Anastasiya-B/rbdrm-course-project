CREATE INDEX idx_orders_user_created_at
ON orders (user_id, created_at DESC);

CREATE INDEX idx_orders_cancelled_created_at
ON orders (created_at DESC)
WHERE status = 'cancelled';

CREATE INDEX idx_users_lower_email
ON users (lower(email));

CREATE INDEX idx_products_search_vector
ON products USING GIN (search_vector);