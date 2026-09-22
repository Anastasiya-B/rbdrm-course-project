CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_not_empty CHECK (length(trim(email)) > 0),
  CONSTRAINT users_full_name_not_empty CHECK (length(trim(full_name)) > 0)
);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      name || ' ' || description
    )
  ) STORED,
  CONSTRAINT products_owner_fk
    FOREIGN KEY (owner_id)
    REFERENCES users(id),
  CONSTRAINT products_name_not_empty
    CHECK (length(trim(name)) > 0),
  CONSTRAINT products_description_not_empty
    CHECK (length(trim(description)) > 0),
  CONSTRAINT products_price_positive
    CHECK (price > 0),
  CONSTRAINT products_stock_non_negative
    CHECK (stock_quantity >= 0)
);

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  total_amount NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_user_fk
    FOREIGN KEY (user_id)
    REFERENCES users(id),
  CONSTRAINT orders_total_non_negative
    CHECK (total_amount >= 0),
  CONSTRAINT orders_status_valid
    CHECK (
      status IN (
        'created',
        'paid',
        'shipped',
        'completed',
        'cancelled'
      )
    )
);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_order_fk
    FOREIGN KEY (order_id)
    REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT order_items_product_fk
    FOREIGN KEY (product_id)
    REFERENCES products(id),
  CONSTRAINT order_items_quantity_positive
    CHECK (quantity > 0),
  CONSTRAINT order_items_price_positive
    CHECK (unit_price > 0)
);